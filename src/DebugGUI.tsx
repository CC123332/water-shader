import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";


export default function DebugGUI({ heightmapVariableRef }) {
  const { scene, gl } = useThree();
  const guiRef = useRef(null);

  useEffect(() => {
    const gui = new GUI();
    guiRef.current = gui;
    gui.domElement.style.position = "fixed";
    gui.domElement.style.right = "0px";
    gui.domElement.style.top = "0px";
    gui.domElement.style.zIndex = "1000";

    const effectController = {
      mouseSize: 0.2,
      mouseDeep: 0.01,
      viscosity: 0.99,
      speed: 5,
      shadow: false,
    };

    const valuesChanger = () => {
      const hv = heightmapVariableRef?.current;
      if (hv?.material?.uniforms) {
        if (hv.material.uniforms["mouseSize"])
          hv.material.uniforms["mouseSize"].value = effectController.mouseSize;
        if (hv.material.uniforms["deep"])
          hv.material.uniforms["deep"].value = effectController.mouseDeep;
        if (hv.material.uniforms["viscosity"])
          hv.material.uniforms["viscosity"].value = effectController.viscosity;
      }
    };

    const addShadow = (enabled) => {
      gl.shadowMap.enabled = !!enabled;
      scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = !!enabled;
          o.receiveShadow = !!enabled;
        }
        if (o.isLight) {
          o.castShadow = !!enabled;
          if ("shadow" in o && o.shadow) {
            o.shadow.bias = -0.0001;
            o.shadow.normalBias = 0.02;
          }
        }
      });
    };

    gui.add(effectController, "mouseSize", 0.1, 1.0, 0.1).onChange(valuesChanger);
    gui.add(effectController, "mouseDeep", 0.01, 1.0, 0.01).onChange(valuesChanger);
    gui.add(effectController, "viscosity", 0.9, 0.999, 0.001).onChange(valuesChanger);
    gui.add(effectController, "speed", 0, 6, 0);
    gui.add(effectController, "shadow").onChange((enabled) => addShadow(enabled));

    valuesChanger();
    return () => {
      gui.destroy();
      guiRef.current = null;
    };
  }, [heightmapVariableRef, gl, scene]);

  return null;
}