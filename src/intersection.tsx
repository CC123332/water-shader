import * as THREE from 'three'

const EPS = 1e-6

type Loop = THREE.Vector2[]

// Compute intersection segments for a BufferGeometry (with index or not) against plane y = 0.
export function intersectGeometryWithPlaneY0(worldMatrix: THREE.Matrix4, geometry: THREE.BufferGeometry): [THREE.Vector3, THREE.Vector3][] {
  const posAttr = geometry.attributes.position as THREE.BufferAttribute
  const index = geometry.index
  const segments: [THREE.Vector3, THREE.Vector3][] = []

  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3()

  const getTri = (i0: number, i1: number, i2: number) => {
    v0.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(worldMatrix)
    v1.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(worldMatrix)
    v2.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(worldMatrix)
  }

  const pushSegment = (p0: THREE.Vector3, p1: THREE.Vector3) => {
    if (p0.distanceToSquared(p1) > EPS) segments.push([p0.clone(), p1.clone()])
  }

  const edgeXPlane = (p0: THREE.Vector3, p1: THREE.Vector3): THREE.Vector3 | null => {
    const y0 = p0.y, y1 = p1.y
    const dy = y1 - y0
    if (Math.abs(dy) < EPS) return null
    const t = -y0 / dy
    if (t > -EPS && t < 1 + EPS) {
      return new THREE.Vector3().copy(p0).add(new THREE.Vector3().subVectors(p1, p0).multiplyScalar(t))
    }
    return null
  }

  const processTri = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
    const on0 = Math.abs(p0.y) < EPS, on1 = Math.abs(p1.y) < EPS, on2 = Math.abs(p2.y) < EPS
    // if the triangle is coplanar, skip (no area; treat elsewhere if needed)
    if (on0 && on1 && on2) return

    const xs: THREE.Vector3[] = []
    const e01 = edgeXPlane(p0, p1); if (e01) xs.push(e01)
    const e12 = edgeXPlane(p1, p2); if (e12) xs.push(e12)
    const e20 = edgeXPlane(p2, p0); if (e20) xs.push(e20)

    if (xs.length === 2) pushSegment(xs[0], xs[1])
  }

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      getTri(index.getX(i), index.getX(i + 1), index.getX(i + 2))
      processTri(v0, v1, v2)
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      getTri(i, i + 1, i + 2)
      processTri(v0, v1, v2)
    }
  }

  return segments
}

// Chain segments into closed loops in XZ (project to UV later)
export function buildLoops(segments: [THREE.Vector3, THREE.Vector3][]): Loop[] {
  const loops: Loop[] = []
  const unused = segments.map(s => [s[0].clone(), s[1].clone()] as [THREE.Vector3, THREE.Vector3])

  const takeClosest = (p: THREE.Vector3, arr: [THREE.Vector3, THREE.Vector3][]) => {
    let bestIdx = -1, bestD = Infinity, flip = false
    for (let i = 0; i < arr.length; i++) {
      const [a, b] = arr[i]
      const da = p.distanceToSquared(a)
      const db = p.distanceToSquared(b)
      if (da < bestD && da < EPS) { bestIdx = i; bestD = da; flip = false }
      if (db < bestD && db < EPS) { bestIdx = i; bestD = db; flip = true }
    }
    return { bestIdx, flip }
  }

  while (unused.length) {
    const [p0, p1] = unused.pop()!
    const loop: THREE.Vector3[] = [p0.clone(), p1.clone()]
    let extended = true
    while (extended) {
      extended = false
      const tail = loop[loop.length - 1]
      // find a segment whose one end equals tail
      let foundIndex = -1, flip = false
      for (let i = 0; i < unused.length; i++) {
        const [a, b] = unused[i]
        if (a.distanceToSquared(tail) < EPS) { foundIndex = i; flip = false; break }
        if (b.distanceToSquared(tail) < EPS) { foundIndex = i; flip = true; break }
      }
      if (foundIndex !== -1) {
        const [a, b] = unused.splice(foundIndex, 1)[0]
        loop.push((flip ? a : b).clone())
        extended = true
      }
    }
    // close if not closed
    if (loop.length >= 3 && loop[0].distanceToSquared(loop[loop.length - 1]) > EPS) loop.push(loop[0].clone())
    // Convert to Vector2 in XZ plane
    const v2: Loop = loop.slice(0, -1).map(v => new THREE.Vector2(v.x, -v.z))
    if (v2.length >= 3) loops.push(v2)
  }
  return loops
}

// UV map from world XZ to plane UV (plane centered at origin on XZ)
export function uvFromXZ(v: THREE.Vector2, planeSize: { width: number; height: number }): THREE.Vector2 {
  return new THREE.Vector2(v.x / planeSize.width + 0.5, v.y / planeSize.height + 0.5)
}

// Triangulate a loop (no holes) using THREE.ShapeUtils
export function triangulateLoopUV(loopUV: THREE.Vector2[]): { positions: Float32Array; indices: Uint32Array } {
  // THREE expects Vector2[] contour & holes[], we have only an outer contour
  const triangles = THREE.ShapeUtils.triangulateShape(loopUV, [])
  const positions = new Float32Array(loopUV.length * 2)
  loopUV.forEach((p, i) => { positions[2 * i] = p.x; positions[2 * i + 1] = p.y })
  const indices = new Uint32Array(triangles.flat())
  return { positions, indices }
}
