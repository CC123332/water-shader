import * as THREE from "three";
import React, { forwardRef } from "react";
import { useGLTF } from '@react-three/drei'

type Props = {
  groupRef?: React.Ref<THREE.Group>;
};

const BrushMesh = forwardRef<THREE.Mesh, Props>(({ groupRef }, ref) => {
  const geo = new THREE.SphereGeometry(0.4, 5, 5);
  const geoShow = new THREE.SphereGeometry(0.3, 5, 5);
  const { nodes, materials } = useGLTF("/models/gltf/duck.glb");

  return (
    <group ref={groupRef}>
      <mesh 
        ref={ref} 
        position={[0, 0, 0]} 
        castShadow 
        geometry={nodes.duck.geometry}
        // scale={[2, 2, 2]}
        scale={[.1, .1, .1]}
      >
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.25}
          metalness={0.2}
          emissive="#333"
          transparent
          opacity={0.0}
          depthWrite={false}
        />
      </mesh>

      {/* <mesh 
        position={[0, 0, 0]} 
        castShadow
        geometry={nodes.duck.geometry}
        material={nodes.duck.material}
        scale={[2, 2, 2]}
      ></mesh> */}
    </group>
  );
});

export default BrushMesh;
