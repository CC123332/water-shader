import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise.js";

export default function WaterGPUCompute({
  materialRef,                // WaterMaterial ref to set materialRef.current.heightmap
  heightmapVariableRef,       // exposes the GPU variable to GUI & mouse updates
  readbackRef,                // exposes { readAtWorld(x,z), readAtUV(u,v) }
  shaderChange,               // { heightmap_frag, ... } main sim shader
  width,
  bounds,
  simParamsRef,               // <-- { current: { speed:number (1..6) } }
  stepCounterRef              // <-- { current:number } incremented after each compute step
}) {
  const { gl } = useThree();
  const gpuRef = useRef(null);
  const readShaderRef = useRef(null);
  const readTargetRef = useRef(null);
  const readBytesRef = useRef(null);   // persistent 4x1 RGBA8 buffer
  const frameRef = useRef(0);      // <-- used for "7 - speed" throttle
  const simplex = useMemo(() => new SimplexNoise(), []);

  // ---------------- Seed texture ----------------
  const fillTexture = (texture) => {
    const waterMaxHeight = 0.1;
    const pixels = texture.image.data;
    let p = 0;

    const noise = (x, y) => {
      let multR = waterMaxHeight;
      let mult = 0.025;
      let r = 0.0;
      for (let i = 0; i < 15; i++) {
        r += multR * simplex.noise(x * mult, y * mult);
        multR *= 0.53 + 0.025 * i;
        mult  *= 1.25;
      }
      return r;
    };

    for (let j = 0; j < width; j++) {
      for (let i = 0; i < width; i++) {
        const x = (i * width) / width;
        const y = (j * width) / width;
        const n = noise(x, y);
        pixels[p + 0] = n;  // current height
        pixels[p + 1] = n;  // previous height
        pixels[p + 2] = 0.0;
        pixels[p + 3] = 1.0;
        p += 4;
      }
    }
  };

  // ---------------- Init GPGPU once ----------------
  useEffect(() => {
    const gpu = new GPUComputationRenderer(width, width, gl);
    gpuRef.current = gpu;

    // Base texture
    const heightmap0 = gpu.createTexture();
    fillTexture(heightmap0);

    // Main simulation variable
    const heightmapVar = gpu.addVariable("heightmap", shaderChange.heightmap_frag, heightmap0);
    gpu.setVariableDependencies(heightmapVar, [heightmapVar]);

    // Uniforms (match your vanilla)
    heightmapVar.material.uniforms["mousePos"]  = { value: new THREE.Vector2(10000, 10000) };
    heightmapVar.material.uniforms["mouseSize"] = { value: 0.2 };
    heightmapVar.material.uniforms["viscosity"] = { value: 0.93 };
    heightmapVar.material.uniforms["deep"]      = { value: 0.01 };

    heightmapVar.material.uniforms["uBounce"]      = { value: 0.9 };   // reflection strength
    heightmapVar.material.uniforms["uRim"]         = { value: (bounds / width) * 2.0 }; // thin shell

    // Defines
    heightmapVar.material.defines = heightmapVar.material.defines || {};
    heightmapVar.material.defines.BOUNDS = bounds.toFixed(1);

    // 4×1 RGBA8 target for the packed floats (Uint8 per channel) + persistent byte buffer
    const readTarget = new THREE.WebGLRenderTarget(4, 1, {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false
    });
    readTargetRef.current = readTarget;
    readBytesRef.current  = new Uint8Array(4 * 1 * 4); // 4 pixels × RGBA8

    // Init GPU
    const err = gpu.init();
    if (err) {
      console.error(err);
      return () => {
        gpuRef.current = null;
        readShaderRef.current = null;
        if (readTargetRef.current) {
          readTargetRef.current.dispose();
          readTargetRef.current = null;
        }
        readBytesRef.current = null;
        if (heightmapVariableRef) heightmapVariableRef.current = null;
      };
    }

    // Expose the compute variable (GUI / mouse updates use this)
    if (heightmapVariableRef) heightmapVariableRef.current = heightmapVar;

    // Prime the water material with the initial texture
    const tex = gpu.getCurrentRenderTarget(heightmapVar).texture;
    if (materialRef?.current) materialRef.current.heightmap = tex;

    // Reset counters
    frameRef.current = 0;
    if (stepCounterRef) stepCounterRef.current = 0;

    return () => {
      gpuRef.current = null;
      if (readTargetRef.current) {
        readTargetRef.current.dispose();
        readTargetRef.current = null;
      }
      readShaderRef.current = null;
      readBytesRef.current = null;
      if (heightmapVariableRef) heightmapVariableRef.current = null;
    };
  }, [gl, shaderChange, width, bounds, heightmapVariableRef, materialRef, stepCounterRef]);

  // ---------------- Readback utilities ----------------
  const decodeFloatFromBytes = (b0, b1, b2, b3) => {
    const buf = new ArrayBuffer(4);
    const u8  = new Uint8Array(buf);
    const dv  = new DataView(buf);
    u8[0] = b0; u8[1] = b1; u8[2] = b2; u8[3] = b3;
    return dv.getFloat32(0, true); // flip to false if values look off on your platform
  };

  // --- Readback utilities (replace this whole useEffect block) ---
  useEffect(() => {
    if (!readbackRef) return;

    const readAtUV = (u, v) => {
      const gpu = gpuRef.current;
      const variable = heightmapVariableRef?.current;
      const readMat = readShaderRef.current;
      const readTarget = readTargetRef.current;
      const bytes = readBytesRef.current;
      if (!gpu || !variable || !readMat || !readTarget || !bytes) return null;

      // EXACT: set uniforms like the original did before doRenderTarget/readPixels
      readMat.uniforms.point1.value.set(u, v);
      readMat.uniforms.levelTexture.value = gpu.getCurrentRenderTarget(variable).texture;

      // Encode (level, nx, ny) into 4×1 RGBA8 and read back
      gpu.doRenderTarget(readMat, readTarget);
      gl.readRenderTargetPixels(readTarget, 0, 0, 4, 1, bytes);

      const level = decodeFloatFromBytes(bytes[0], bytes[1], bytes[2], bytes[3]);
      const nx = decodeFloatFromBytes(bytes[4], bytes[5], bytes[6], bytes[7]);
      const ny = decodeFloatFromBytes(bytes[8], bytes[9], bytes[10], bytes[11]);

      return { level, normal: [nx, ny] };
    };

    const readAtWorld = (x, z) => {
      const u = x / bounds + 0.5;
      const v = 0.5 - z / bounds;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return readAtUV(u, v);
    };

    readbackRef.current = { readAtUV, readAtWorld };
    return () => { if (readbackRef.current) readbackRef.current = null; };
  }, [gl, bounds, heightmapVariableRef, readbackRef]);

  useFrame(() => {
    const gpu = gpuRef.current;
    const variable = heightmapVariableRef?.current;
    if (!gpu || !variable) return;

    // ---- speed/throttle logic (unchanged) ----
    const speed = Math.min(6, Math.max(1, simParamsRef?.current?.speed ?? 5));
    const threshold = 7 - speed;
    frameRef.current += 1;

    if (frameRef.current >= threshold) {
      gpu.compute();
      const tex = gpu.getCurrentRenderTarget(variable).texture;
      if (materialRef?.current) materialRef.current.heightmap = tex;
      if (stepCounterRef) stepCounterRef.current = (stepCounterRef.current ?? 0) + 1;
      frameRef.current = 0;
    }
  });

  return null;
}