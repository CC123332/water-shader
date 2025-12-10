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

type Params = {
    alpha: number
    wetness: number
    absoluteAlpha: boolean
    dry: number
    proximity: number      // |y| < proximity to paint
}

type Props = {
    planeSize: { width: number; height: number }
    brushRef: React.RefObject<THREE.Mesh>
    outTextureRef: React.RefObject<THREE.Texture | null>
    groupRef: React.RefObject<THREE.Group | null>
    params: Params
}

/**
 * Pipeline:
 * 1) compute brush ∩ plane (world y=0) → UV polygon(s) once per frame (CPU).
 * 2) rasterize polygon(s) into a mask FBO (0..1).
 * 3) accumulate: new = dry*prev  (then) mix/add mask*wetness with Absolute Alpha toggle.
 * 4) expose the accumulated texture for the plane material.
 */
export default function PaintSim({ planeSize, brushRef, outTextureRef, groupRef, params }: Props) {
    const { gl } = useThree()

    // Accumulator ping-pong
    const accA = useFBO(1024, 1024, { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType })
    const accB = useFBO(1024, 1024, { depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType })

    // Mask FBO
    const maskFBO = useFBO(1024, 1024, { depthBuffer: false, stencilBuffer: false, type: THREE.FloatType })

    const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
    const quadScene = useMemo(() => new THREE.Scene(), [])

    // Fullscreen quad material for accumulation
    const accMat = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uPrev: { value: null as THREE.Texture | null },
            uMask: { value: null as THREE.Texture | null },
            uAlpha: { value: params.alpha },
            uWet: { value: params.wetness },
            uAbs: { value: params.absoluteAlpha ? 1.0 : 0.0 },
            uDry: { value: params.dry }
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform sampler2D uPrev;
            uniform sampler2D uMask;
            uniform float uAlpha, uWet, uAbs, uDry;
            varying vec2 vUv;
            void main() {
                vec3 prev = texture2D(uPrev, vUv).rgb * uDry;
                float m = texture2D(uMask, vUv).r;   // 0..1
                vec3 paint = vec3(1.0) * (m * uWet);
                vec3 outc = mix(prev, paint, uAbs * m * uAlpha) + (1.0 - uAbs) * paint * uAlpha;
                gl_FragColor = vec4(outc, 1.0);
            }`,
        depthTest: false,
        depthWrite: false
    }), [])

    const quadGeom = useMemo(() => new THREE.PlaneGeometry(2, 2), [])
    const quadMesh = useMemo(() => new THREE.Mesh(quadGeom, accMat), [accMat, quadGeom])
    quadScene.add(quadMesh)

    // Geometry used to render mask polygons in UV → NDC space
    const maskScene = useMemo(() => new THREE.Scene(), [])
    const maskCamera = ortho
    const maskMaterial = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uCenterXZ:    { value: new THREE.Vector2(0, 0) },         // group.position.xz
            uPlaneSize:   { value: new THREE.Vector2(planeSize.width, planeSize.height) },
        },
        vertexShader: /* glsl */`
            attribute vec2 uvPos; // already in [0..1]
            varying vec2 vUvMask;
            void main(){
                vUvMask = uvPos;
                vec2 ndc = uvPos * 2.0 - 1.0;
                gl_Position = vec4(ndc, 0.0, 1.0);
            }`,
        fragmentShader: /* glsl */`
            varying vec2 vUvMask;
            uniform vec2  uCenterXZ;
            uniform vec2  uPlaneSize;

            vec2 uvToWorldXZ(vec2 uv){
                float x = (uv.x - 0.5) * uPlaneSize.x;
                float z = -(uv.y - 0.5) * uPlaneSize.y;
                return vec2(x, z);
            }

            void main(){
                // Radial falloff from group center in world space
                vec2  worldXZ = uvToWorldXZ(vUvMask);
                float d       = length(worldXZ - uCenterXZ);

                float radial  = max(1.0 - d * 2.5, 0.);

                // RED channel carries mask (attenuated by distance)
                gl_FragColor = vec4(radial, 0.0, 0.0, 1.0);
            }`,
        transparent: false,
        depthTest: false,
        depthWrite: false
    }), [planeSize.width, planeSize.height])


    // Mesh for the current frame's polygon(s)
    const maskMeshRef = useRef<THREE.Mesh | null>(null)

    useEffect(() => {
        // init empty mesh
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
    }, [])

    const ping = useRef(true)
    outTextureRef.current = accA.texture

    useFrame(() => {
        const brush = brushRef.current
        const group = groupRef.current
        if (!brush || !group) return

        // --- NEW: update mask uniforms each frame ---
        const mm = maskMaterial as THREE.ShaderMaterial
        // group world position’s XZ
        mm.uniforms.uCenterXZ.value.set(group.position.x, group.position.z)

        // If planeSize can change, keep it synced:
        mm.uniforms.uPlaneSize.value.set(planeSize.width, planeSize.height)

        // (1) gate by proximity: only paint if close to plane y=0
        const distToPlane = Math.abs(brush.position.y)
        const shouldPaint = distToPlane < params.proximity

        // (2) compute intersection polygon(s) once (if painting)
        let hadGeometry = false
        if (shouldPaint) {
            const world = brush.matrixWorld.clone()
            // ensure world matrix is current
            brush.updateWorldMatrix(true, false)

            // if the geometry is instanced/skinned, you may need to bake; here we assume plain BufferGeometry
            const geom = (brush.geometry as THREE.BufferGeometry)
            const segs = intersectGeometryWithPlaneY0(world, geom)
            const loopsXZ = buildLoops(segs) // in XZ (x, -z)

            // Merge all loops into one geometry in UV space
            const uvLoops: THREE.Vector2[][] = loopsXZ.map(loop => loop.map(p => uvFromXZ(p, planeSize)))
            // Build a single geometry by concatenating triangulations
            let totalVerts = 0
            let totalInds = 0
            const parts = uvLoops.map(loop => {
                const { positions, indices } = triangulateLoopUV(loop)
                totalVerts += positions.length / 2
                totalInds += indices.length
                return { positions, indices }
            })

            const pos = new Float32Array(totalVerts * 2)
            const ind = new Uint32Array(totalInds)
            let vOfs = 0
            let iOfs = 0
            parts.forEach(({ positions, indices }) => {
                pos.set(positions, vOfs * 2)
                for (let i = 0; i < indices.length; i++) ind[iOfs + i] = indices[i] + vOfs
                vOfs += positions.length / 2
                iOfs += indices.length
            })

            // update mask mesh geometry (calculated ONCE this frame)
            const g = maskMeshRef.current!.geometry as THREE.BufferGeometry
            g.setAttribute('uvPos', new THREE.BufferAttribute(pos, 2))
            g.setIndex(new THREE.BufferAttribute(ind, 1))
            g.computeBoundingSphere()
            hadGeometry = totalInds > 0
        } else {
            // clear geometry to avoid stale paint when out of range
            const g = maskMeshRef.current!.geometry as THREE.BufferGeometry
            g.setAttribute('uvPos', new THREE.BufferAttribute(new Float32Array(0), 2))
            g.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
        }

        // (3) render mask (clear = 0)
        gl.setRenderTarget(maskFBO)
        gl.clearColor()
        gl.clear(true, true, true)
        if (hadGeometry) {
            gl.render(maskScene, maskCamera)
        }
        gl.setRenderTarget(null)

        // (4) accumulate
        const read = ping.current ? accA : accB
        const write = ping.current ? accB : accA
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uPrev.value = read.texture
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uMask.value = maskFBO.texture
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = params.alpha
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uWet.value = params.wetness
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uAbs.value = params.absoluteAlpha ? 1.0 : 0.0
        ;(quadMesh.material as THREE.ShaderMaterial).uniforms.uDry.value = params.dry

        gl.setRenderTarget(write)
        gl.render(quadScene, ortho)
        gl.setRenderTarget(null)

        outTextureRef.current = write.texture
        ping.current = !ping.current
    })

    return null
}