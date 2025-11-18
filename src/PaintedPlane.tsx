import * as THREE from 'three'
import { useMemo } from 'react'

type Props = {
  planeSize: { width: number; height: number }
  paintTexRef: React.RefObject<THREE.Texture | null>
}

export default function PaintedPlane({ planeSize, paintTexRef }: Props) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPaint: { value: null as THREE.Texture | null },
          uStrength: { value: 1.9 } // Emission strength (like Blender node)
        },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */`
          uniform sampler2D uPaint;
          uniform float uStrength;
          varying vec2 vUv;
          void main() {
            vec3 c = texture2D(uPaint, vUv).rgb;
            gl_FragColor = vec4(c * uStrength, 1.0);
          }`,
      }),
    []
  )

  mat.uniforms.uPaint.value = paintTexRef.current

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[planeSize.width, planeSize.height, 1, 1]} />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}
