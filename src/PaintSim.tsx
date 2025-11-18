import * as THREE from 'three'
import { useFBO } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
    intersectGeometryWithPlaneY0,
    buildLoops,
    uvFromXZ,
    triangulateLoopUV
} from './intersection'
import {
    blurMatX,
    blurMatY,
    blurVert,
    fbmFrag,
} from './ShaderCode'

type Props = {
    planeSize: { width: number; height: number }
    brushRef: React.RefObject<THREE.Mesh>
    outTextureRef: React.RefObject<THREE.Texture | null>
    groupRef: React.RefObject<THREE.Group | null>
}

export default function PaintSim({ planeSize, brushRef, outTextureRef, groupRef }: Props) {
    const { gl } = useThree()
    const FBO_SIZE = 1024

    // Accumulator ping-pong
    const accA = useFBO(FBO_SIZE, FBO_SIZE, { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType })
    const accB = useFBO(FBO_SIZE, FBO_SIZE, { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType })

    // Mask + blur intermediates
    const maskFBO = useFBO(FBO_SIZE, FBO_SIZE, { depthBuffer: false, stencilBuffer: false, type: THREE.FloatType })
    const blurA   = useFBO(FBO_SIZE, FBO_SIZE, { depthBuffer: false, stencilBuffer: false, type: THREE.FloatType })
    const blurB   = useFBO(FBO_SIZE, FBO_SIZE, { depthBuffer: false, stencilBuffer: false, type: THREE.FloatType })

    // Fullscreen infra
    const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
    const quadScene = useMemo(() => new THREE.Scene(), [])
    const quadGeom = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
    
    // Accumulation shader
    const accMat = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uPrev:  { value: null as THREE.Texture | null },
            uMask:  { value: null as THREE.Texture | null },
            uAlpha: { value: 1. },
            uWet:   { value: 1.0 },
            uAbs:   { value: 1.0 },
            uDry:   { value: 0.96 }
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`
        ,
        fragmentShader: /* glsl */`
            uniform sampler2D uPrev;
            uniform sampler2D uMask;
            uniform float uAlpha, uWet, uAbs, uDry;
            varying vec2 vUv;

            float colorRamp(float t){
                // Key stops
                float black = 0.072727;
                float white = 0.177273;
                float color = 1.0;

                if (t <= black) {
                    color = 0.0; // solid black
                }
                else if (t <= white) {
                    // Linear interpolation: black → white
                    float f = (t - black) / (white - black);
                    color = mix(0.0, 1.0, f);
                }
                else {
                    color = 1.0; // solid white again
                }

                return color;
            }

            void main() {
                // --- PAINT ACCUMULATION ---
                vec3 prev = texture2D(uPrev, vUv).rgb * uDry;
                vec3 maskSample = texture2D(uMask, vUv).rgb;

                float m = maskSample.r;

                // plain paint contribution
                vec3 paint = vec3(1.0) * (m * uWet);

                // outc = your “wet paint buffer” result
                vec3 outc = mix(prev, paint, uAbs * m * uAlpha) +
                            (1.0 - uAbs) * paint * uAlpha;

                // --- EMISSION BASED ON MASK / RAMP ---
                vec3 blue = vec3(0.454, 0.893, 1.0);

                // you can also try using outc.r here instead of m if you want emission from paint intensity
                float subtract    = outc.r;
                float add_result  = maskSample.g; // texture2D(uMask, vUv).y

                float surface_tone = clamp(
                    pow(colorRamp(add_result) * 9.07, 2.6),
                    0.0,
                    1.0
                );

                vec3 emissionColor = mix(vec3(0.0), blue, surface_tone);

                float emissionStrength = pow(m * 10.0, 13.37) + 0.2;

                vec3 emission = emissionColor * emissionStrength;

                // --- COMBINE PAINT + EMISSION ---
                vec3 finalColor = outc + emission;

                // keep it in visible range
                finalColor = clamp(finalColor, 0.0, 1.0);

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        depthTest: false,
        depthWrite: false
    }), [])

    // Create fullscreen quad with ShaderMaterial type to avoid TS errors
    const quadMesh = useMemo(
        () => new THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>(quadGeom, accMat),
        [quadGeom, accMat]
    )
    quadMesh.frustumCulled = false
    quadScene.add(quadMesh)

    // Mask rasterization (binary in RED)
    const maskScene = useMemo(() => new THREE.Scene(), [])
    const maskCamera = ortho
    const maskMaterial = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: /* glsl */`
            attribute vec2 uvPos; // [0..1]
            varying vec2 vUvMask;
            void main(){
                vUvMask = uvPos;
                vec2 ndc = uvPos * 2.0 - 1.0;
                gl_Position = vec4(ndc, 0.0, 1.0);
            }`,
        fragmentShader: /* glsl */`
            varying vec2 vUvMask;
            void main(){
                gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // solid inside
            }`,
        transparent: false, depthTest: false, depthWrite: false
    }), [])
    const maskMeshRef = useRef<THREE.Mesh | null>(null)

    useEffect(() => {
            const geom = new THREE.BufferGeometry()
            geom.setAttribute('uvPos', new THREE.BufferAttribute(new Float32Array(0), 2))
            geom.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
            const m = new THREE.Mesh(geom, maskMaterial)
            m.frustumCulled = false
            maskScene.add(m)
            maskMeshRef.current = m
            return () => {
            maskScene.remove(m)
            geom.dispose()
            m.geometry.dispose()
            }
    }, [maskMaterial, maskScene])

    const ping = useRef(true)
    outTextureRef.current = accA.texture

    const OCTAVES = 6;
    const GAIN = 0.8;


    const fbmMat = new THREE.ShaderMaterial({
        uniforms: {
            uTex:         { value: null as THREE.Texture | null },
            uScale:       { value: 8 },
            uOctaves:     { value: OCTAVES },
            uGain:        { value: GAIN },
            uLacunarity:  { value: 2.0 },
            uNormalize:   { value: 1. },
            t:            { value: 0.0 },
        },
        vertexShader: blurVert,
        fragmentShader: fbmFrag,
        depthTest: false,
        depthWrite: false
    });

    useFrame((state) => {
        const brush = brushRef.current
        const group = groupRef.current
        if (!brush || !group) return

        const elapsed = state.clock.getElapsedTime();
        fbmMat.uniforms.t.value = elapsed * 30; // or scale it if needed

        const distToPlane = Math.abs(brush.position.y)
        const shouldPaint = distToPlane < 0.7

        let hadGeometry = false
        if (shouldPaint) {
            brush.updateWorldMatrix(true, false)
            const world = brush.matrixWorld.clone()
            const geom = brush.geometry
            const segs = intersectGeometryWithPlaneY0(world, geom)
            const loopsXZ = buildLoops(segs)
            const uvLoops: THREE.Vector2[][] = loopsXZ.map(loop => loop.map(p => uvFromXZ(p, planeSize)))

            let totalVerts = 0, totalInds = 0
            const parts = uvLoops.map(loop => {
                const { positions, indices } = triangulateLoopUV(loop)
                totalVerts += positions.length / 2
                totalInds  += indices.length
                return { positions, indices }
            })
            const pos = new Float32Array(totalVerts * 2)
            const ind = new Uint32Array(totalInds)
            let vOfs = 0, iOfs = 0
            parts.forEach(({ positions, indices }) => {
                pos.set(positions, vOfs * 2)
                for (let i = 0; i < indices.length; i++) ind[iOfs + i] = indices[i] + vOfs
                vOfs += positions.length / 2
                iOfs += indices.length
            })

            const g = maskMeshRef.current!.geometry
            g.setAttribute('uvPos', new THREE.BufferAttribute(pos, 2))
            g.setIndex(new THREE.BufferAttribute(ind, 1))
            g.computeBoundingSphere()
            hadGeometry = totalInds > 0
        } else {
            const g = maskMeshRef.current!.geometry
            g.setAttribute('uvPos', new THREE.BufferAttribute(new Float32Array(0), 2))
            g.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
        }

        // (3) draw binary mask
        gl.setRenderTarget(maskFBO)
        gl.clearColor()
        gl.clear(true, true, true)
        if (hadGeometry) gl.render(maskScene, maskCamera)

        // (3.5) blur X: maskFBO -> blurA
        quadMesh.material = blurMatX
        blurMatX.uniforms.uTex.value = maskFBO.texture
        gl.setRenderTarget(blurA)
        gl.render(quadScene, ortho)

        // (3.6) blur Y: blurA -> blurB
        quadMesh.material = blurMatY
        blurMatY.uniforms.uTex.value = blurA.texture
        gl.setRenderTarget(blurB)
        gl.render(quadScene, ortho)

        // // (3.7) fBM mask: blurB -> blurA  (final fBM-masked float in R)
        quadMesh.material = fbmMat;
        fbmMat.uniforms.uTex.value = blurB.texture;
        gl.setRenderTarget(blurA);
        gl.render(quadScene, ortho);

        // final blurred mask texture (allows soft glow outside)
        const finalMaskTex = blurA.texture;

        // (4) accumulate
        const read  = ping.current ? accA : accB
        const write = ping.current ? accB : accA

        quadMesh.material = accMat
        accMat.uniforms.uPrev.value  = read.texture
        accMat.uniforms.uMask.value = finalMaskTex;

        gl.setRenderTarget(write)
        gl.render(quadScene, ortho)
        gl.setRenderTarget(null)

        outTextureRef.current = write.texture
        ping.current = !ping.current
    })

    return null
}
