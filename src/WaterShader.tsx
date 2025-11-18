import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

/**
 * Water plane that matches your imperative Three.js setup.
 * Props:
 * - shaderChange: { common, beginnormal_vertex, begin_vertex } (required)
 * - heightmapTexture: THREE.Texture (optional, set as material.heightmap)
 */
export default function WaterPlane({ 
    shaderChange, 
    heightmapTexture = null, 
    materialRef,
    BOUNDS,
    WIDTH
}) {

    class WaterMaterial extends THREE.MeshStandardMaterial {
        constructor(parameters) {
            super();
            this.defines = {
                STANDARD: "",
                USE_UV: "",
                WIDTH: WIDTH.toFixed(1),
                BOUNDS: BOUNDS.toFixed(1),
            };
            this.extra = {};
            this.addParameter("heightmap", null);
            this.setValues(parameters);
        }

        addParameter(name, value) {
            this.extra[name] = value;
            Object.defineProperty(this, name, {
                get: () => this.extra[name],
                set: (v) => {
                    this.extra[name] = v;
                    if (this.userData.shader)
                    this.userData.shader.uniforms[name].value = this.extra[name];
                }
            });
        }

        onBeforeCompile(shader) {
            // add uniforms
            shader.uniforms.uDispScale     = { value: 1.0 };
            shader.uniforms.uTime          = { value: 0.0 };
            shader.uniforms.uVoroScale     = { value: 10.0 };   // tiling density
            shader.uniforms.uVoroIntensity = { value: 0.8 };  // blend amount 0..1
            shader.uniforms.uVoroContrast  = { value: 1.25 };  // >1 = crisper cells
            shader.uniforms.uVoroAnimate   = { value: 0.15 };  // scroll speed

            // declare uniforms
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
                #include <common>
                   uniform float uTime;
                   uniform float uVoroScale;
                   uniform float uVoroIntensity;
                   uniform float uVoroContrast;
                   uniform float uVoroAnimate;

                    // --- Voronoi helpers (Euclidean F1) ---
                    // simple 2D hash
                    float hash12(vec2 p){
                    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
                    p3 += dot(p3, p3.yzx + 33.33);
                    return fract((p3.x + p3.y) * p3.z);
                    }
                    vec2 hash22(vec2 p){
                    float n = sin(dot(p, vec2(41.0, 289.0)));
                    return fract(vec2(262144.0, 32768.0) * n);
                    }
                    // returns distance to nearest cell center
                    float voronoiF1(vec2 uv){
                    vec2 g = floor(uv);
                    vec2 f = fract(uv);
                    float res = 1.0;
                    for(int j=-1; j<=1; j++){
                        for(int i=-1; i<=1; i++){
                        vec2 o = vec2(float(i), float(j));
                        vec2 r = o + hash22(g + o) - f;
                        float d = dot(r, r); // Euclidean^2
                        res = min(res, d);
                        }
                    }
                    return sqrt(res); // Euclidean
                    }
                `
            );

            // inject the style pass right before dithering/output
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `
                // --- Voronoi style overlay ---
                // Uses MeshStandardMaterial's vUv (you already enable USE_UV)
                vec2 vuv = vUv * uVoroScale + vec2(0.0, uTime * uVoroAnimate);
                float v  = voronoiF1(vuv);

                // remap & contrast
                v = clamp(v, 0.0, 1.0);
                v = pow(v, uVoroContrast);

                // Make brighter lines at cell borders (invert & sharpen a touch)
                float edges = smoothstep(0.0, 0.9, 1.0 - v);

                // Blend into final color; keep it subtle so lighting remains dominant
                gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb + edges * 0.25, uVoroIntensity);

                #include <dithering_fragment>
                `
            );

            for (const name in this.extra) {
                shader.uniforms[name] = { value: this.extra[name] };
            }

            if (this.userData.shaderChange) {
                shader.vertexShader = shader.vertexShader.replace(
                    "#include <common>",
                    this.userData.shaderChange.common
                );
                shader.vertexShader = shader.vertexShader.replace(
                    "#include <beginnormal_vertex>",
                    this.userData.shaderChange.beginnormal_vertex
                );
                shader.vertexShader = shader.vertexShader.replace(
                    "#include <begin_vertex>",
                    this.userData.shaderChange.begin_vertex
                );
            }
            this.userData.shader = shader;
        }
    }

    const meshRef = useRef();

    const geometry = new THREE.PlaneGeometry(BOUNDS, BOUNDS, WIDTH - 1, WIDTH - 1);

    const material = useMemo(() => {
        const mat = new WaterMaterial({
            color: 0x9bd2ec,
            metalness: 0.9,
            roughness: 0,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
        });
        mat.userData.shaderChange = shaderChange;
        mat.heightmap = heightmapTexture; // initial (GPU will overwrite each frame)
        return mat;
    }, [shaderChange, heightmapTexture]);

    material.depthWrite = false;   // key for transparency + seeing what's behind

    // expose the material instance so GPU compute can set mat.heightmap directly
    useEffect(() => {
        if (materialRef) {
            materialRef.current = material;
        }
    }, [material, materialRef]);

    // drive time uniform
    useFrame((state) => {
      const t = state.clock.getElapsedTime();
      const sh = material.userData?.shader;
      if (sh && sh.uniforms?.uTime) {
        sh.uniforms.uTime.value = t;
      }
    });

    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;
        mesh.rotation.x = -Math.PI * 0.5;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.renderOrder = 10;
    }, []);

    return <mesh ref={meshRef} geometry={geometry} material={material} ></mesh>;
}