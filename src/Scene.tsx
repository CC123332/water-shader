import * as THREE from "three";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

import PaintSim from "./PaintSim"
import PaintedPlane from "./PaintedPlane"
import BrushMesh  from "./BrushMesh"

export default function Scene() {
  // plane size (world units), canvas lies in XZ at y = 0
  const planeSize = { width: 6, height: 6 }

  // expose sim texture for plane to display
  const simTexRef = useRef<THREE.Texture | null>(null)

  // mesh ref (for the inner brush mesh)
  const brushRef = useRef<THREE.Mesh>(null!);
  // group ref (wrapper group for both meshes)
  const groupRef = useRef<THREE.Group>(null!);

  // useFrame(({ clock }) => {
  //   const t = clock.getElapsedTime();
  //   const mesh = brushRef.current;
  //   const group = groupRef.current;
  //   if (!mesh || !group) return;

  //   // rotate & move the whole group
  //   group.rotation.y += 0.005;
  //   group.position.set(Math.cos(t * 0.2) * 1.6, 0, Math.sin(t * 0.2) * 1.6);
  // });

  return (
    <>
      <PaintSim
        planeSize={planeSize}
        brushRef={brushRef}
        groupRef={groupRef}
        outTextureRef={simTexRef}
      />
      <PaintedPlane planeSize={planeSize} paintTexRef={simTexRef}/>
      <BrushMesh ref={brushRef} groupRef={groupRef} />
      <gridHelper args={[10, 10, '#444', '#222']} position={[0, -0.001, 0]} />
    </>
  )
}