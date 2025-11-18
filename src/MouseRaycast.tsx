import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";

export default function MouseRaycast({
  heightmapVariableRef,     // same variable from WaterGPUCompute
  controlsRef,               // ref to <OrbitControls />
  BOUNDS,
}) {
  const { camera, gl } = useThree();
  const meshRef     = useRef();                   // the invisible plane (meshRay)
  const raycaster   = useMemo(() => new THREE.Raycaster(), []);
  const mouseNDC    = useRef(new THREE.Vector2());
  const isDown      = useRef(false);

  // geometry/material for meshRay
  const geometry = useMemo(() => new THREE.PlaneGeometry(BOUNDS, BOUNDS, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, visible: false }), []);

  // Pointer events to mirror your container listeners
  const onPointerMove = (e) => {
    const dom = gl.domElement;
    const rect = dom.getBoundingClientRect();
    mouseNDC.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    );
  };
  const onPointerDown = () => {
    isDown.current = true;
  };
  const onPointerUp = () => {
    isDown.current = false;
    if (controlsRef?.current) controlsRef.current.enabled = true;
  };

  // Setup plane like your snippet
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.rotation.x = -Math.PI / 2;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }, []);

  // Core raycast each frame (exactly like your raycast() function)
  useFrame(() => {
    const hv = heightmapVariableRef?.current;
    if (!hv?.material?.uniforms) return;

    const uniforms = hv.material.uniforms;

    if (isDown.current) {
      raycaster.setFromCamera(mouseNDC.current, camera);
      if (meshRef.current) {
        const hits = raycaster.intersectObject(meshRef.current);
        if (hits.length > 0) {
          const pt = hits[0].point;
          uniforms["mousePos"].value.set(pt.x, pt.z);
          if (controlsRef?.current?.enabled) controlsRef.current.enabled = false;
        } else {
          uniforms["mousePos"].value.set(10000, 10000);
        }
      }
    } else {
      uniforms["mousePos"].value.set(10000, 10000);
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    />
  );
}