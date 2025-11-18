import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";

export default function PoolBorder() {
  const meshRef = useRef();

  // Create torus geometry with same settings
  const geometry = useMemo(() => {
    const g = new THREE.TorusGeometry(4.2, 0.1, 12, 4);
    g.rotateX(Math.PI * 0.5);
    g.rotateY(Math.PI * 0.25);
    return g;
  }, []);

  // Create material
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x908877,
        roughness: 0.2,
      }),
    []
  );

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.castShadow = true;
      meshRef.current.receiveShadow = true;
    }
  }, []);

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}