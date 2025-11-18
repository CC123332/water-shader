import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";

import WaterPlane from "./WaterShader"
import WaterGPUCompute from "./WaterGPUCompute"
import DebugGUI from "./DebugGUI"
import Lights from "./Lights"
import EnvironmentHDR from "./EnvironmentHDR"
import PoolBorder from "./PoolBoder"
import RaycastPlane from "./RaycastPlane"
import MouseRaycast from "./MouseRaycast"



import Scene from "./Scene"

const BOUNDS = 6;   // world size that shader uses for scaling
const WIDTH = 128;  // simulation texture size


export default function App() {
  // controls ref to toggle enabled/disabled from raycaster
  const controlsRef = useRef(null);

  const heightmapVariableRef = useRef(null);
  const waterMaterialRef     = useRef(null);
  const readbackRef          = useRef(null);
  const simParamsRef         = useRef({ speed: 5 });
  const stepCounterRef       = useRef(0);
  
  // Provide your shader chunks here:
  const shaderChange = useMemo(
    () => ({

        heightmap_frag: /* glsl */`
          #include <common>

          uniform vec2 mousePos;
          uniform float mouseSize;
          uniform float viscosity;
          uniform float deep;

          void main()	{

            vec2 cellSize = 1.0 / resolution.xy;

            vec2 uv = gl_FragCoord.xy * cellSize;

            // heightmapValue.x == height from previous frame
            // heightmapValue.y == height from penultimate frame
            // heightmapValue.z, heightmapValue.w not used
            vec4 heightmapValue = texture2D( heightmap, uv );

            // Get neighbours
            vec4 north = texture2D( heightmap, uv + vec2( 0.0, cellSize.y ) );
            vec4 south = texture2D( heightmap, uv + vec2( 0.0, - cellSize.y ) );
            vec4 east = texture2D( heightmap, uv + vec2( cellSize.x, 0.0 ) );
            vec4 west = texture2D( heightmap, uv + vec2( - cellSize.x, 0.0 ) );

            //float newHeight = ( ( north.x + south.x + east.x + west.x ) * 0.5 - heightmapValue.y ) * viscosity;
            float newHeight = ( ( north.x + south.x + east.x + west.x ) * 0.5 - (heightmapValue.y) ) * viscosity;


            // Mouse influence
            float mousePhase = clamp( length( ( uv - vec2( 0.5 ) ) * BOUNDS - vec2( mousePos.x, - mousePos.y ) ) * PI / mouseSize, 0.0, PI );
            //newHeight += ( cos( mousePhase ) + 1.0 ) * 0.28 * 10.0;
            newHeight -= ( cos( mousePhase ) + 1.0 ) * deep;

            heightmapValue.y = heightmapValue.x;
            heightmapValue.x = newHeight;

            gl_FragColor = heightmapValue;

          }
        `,
        // FOR MATERIAL
        common: /* glsl */`
          #include <common>
          uniform sampler2D heightmap;
          uniform float uDispScale;
        `,
        beginnormal_vertex: /* glsl */`
          vec2 cellSize = vec2( 1.0 / WIDTH, 1.0 / WIDTH );
          vec3 objectNormal = vec3(
            ( texture2D( heightmap, uv + vec2( - cellSize.x, 0 ) ).x - texture2D( heightmap, uv + vec2( cellSize.x, 0 ) ).x ) * WIDTH / BOUNDS * uDispScale,
            ( texture2D( heightmap, uv + vec2( 0, - cellSize.y ) ).x - texture2D( heightmap, uv + vec2( 0, cellSize.y ) ).x ) * WIDTH / BOUNDS * uDispScale,
            1.0 );
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif
        `,
        begin_vertex: /* glsl */`
          float heightValue = texture2D( heightmap, uv ).x;
          vec3 transformed = vec3( position.x, position.y, heightValue * uDispScale );
          #ifdef USE_ALPHAHASH
            vPosition = vec3( position );
          #endif
        `,
      }),
    []
  );

  const waterMeshRef  = useRef()

  useEffect(() => {
    if (waterMeshRef.current) waterMeshRef.current.layers.set(8)
  }, [])

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* <Canvas
        shadows
        camera={{ fov: 50, position: [0, 2, 6] }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.5,
        }}
      >
        <OrbitControls ref={controlsRef} enableDamping makeDefault />
        <Lights/>

        <Suspense
          fallback={
            <Html center style={{ color: "white", fontSize: 14 }}>
              Loading assets…
            </Html>
          }
        >
          <EnvironmentHDR/>

          <RaycastPlane heightmapVariableRef={heightmapVariableRef} BOUNDS={BOUNDS}/>

          <WaterPlane
            shaderChange={shaderChange}
            heightmapTexture={null}
            materialRef={waterMaterialRef}
            BOUNDS={BOUNDS}
            WIDTH={WIDTH}
          />

          <WaterGPUCompute
            materialRef={waterMaterialRef}
            heightmapVariableRef={heightmapVariableRef}
            readbackRef={readbackRef}
            shaderChange={shaderChange}
            width={WIDTH}
            bounds={BOUNDS}
            simParamsRef={simParamsRef}
            stepCounterRef={stepCounterRef}
          />

          <MouseRaycast
            heightmapVariableRef={heightmapVariableRef}
            controlsRef={controlsRef}
            BOUNDS={BOUNDS}
          />

          <PoolBorder />
        </Suspense>

        <DebugGUI heightmapVariableRef={heightmapVariableRef}/>
      </Canvas>       */}
      <Canvas gl={{ antialias: true }} camera={{ position: [0, 3, 6], fov: 40 }}>
        <color attach="background" args={['#0b0b0b']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[3, 6, 4]} intensity={1.2} />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
        <OrbitControls />
      </Canvas>
    </div>
  );
}
