import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";

export default function RaycastPlane({ heightmapVariableRef, BOUNDS }) {
  const meshRef = useRef();
  const { camera, gl, controls } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouse     = useRef(new THREE.Vector2());
  const mousedown = useRef(false);

  const geometry = useMemo(() => new THREE.PlaneGeometry(BOUNDS, BOUNDS, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, visible: false }), []);

  const setMouseUniform = (x, z) => {
    const hv = heightmapVariableRef?.current;
    if (hv?.material?.uniforms?.mousePos) hv.material.uniforms.mousePos.value.set(x, z);
  };
  const resetMouseUniform = () => setMouseUniform(10000, 10000);

  const onPointerMove = (e) => {
    const { width, height } = gl.domElement.getBoundingClientRect();
    mouse.current.set((e.clientX / width) * 2 - 1, -(e.clientY / height) * 2 + 1);

    if (!mousedown.current) {
      resetMouseUniform();
      return;
    }

    // raycast like your function
    raycaster.setFromCamera(mouse.current, camera);
    if (meshRef.current) {
      const hits = raycaster.intersectObject(meshRef.current);
      if (hits.length > 0) {
        const p = hits[0].point;
        setMouseUniform(p.x, p.z);
        if (controls?.enabled) controls.enabled = false;
      } else {
        resetMouseUniform();
      }
    }
  };

  const onPointerDown = () => { mousedown.current = true; };
  const onPointerUp   = () => {
    mousedown.current = false;
    resetMouseUniform();
    if (controls) controls.enabled = true;
  };

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.rotation.x = -Math.PI / 2;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  }, []);

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