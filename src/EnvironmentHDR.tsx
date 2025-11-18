import { useLoader, useThree } from "@react-three/fiber";
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import * as THREE from "three";
import { useEffect } from "react";

export default function EnvironmentHDR() {
  const { scene } = useThree();
  const env = useLoader(HDRLoader, "/textures/equirectangular/blouberg_sunrise_2_1k.hdr");

  useEffect(() => {
    env.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = env;
    scene.background = env;
    return () => {
      if (scene.background === env) scene.background = null;
      if (scene.environment === env) scene.environment = null;
    };
  }, [env, scene]);

  return null;
}