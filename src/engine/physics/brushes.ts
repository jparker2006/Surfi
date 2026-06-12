import * as THREE from 'three'

// Convex brushes are plane sets, traced against with Minkowski expansion.
// Vertices, faces, and edges are kept alongside the planes so render meshes
// and debug wireframes are generated from the exact collision geometry.

export interface BrushPlane {
  n: THREE.Vector3
  d: number // dot(n, point on plane)
  // bevel planes tighten swept-hull traces at sharp edges; they are not real
  // surfaces and never count as standable ground
  bevel?: boolean
  // seam caps: end cross-sections of ramp pieces, flush against a neighbor.
  // A rider should never be stopped by one; see the rampbug fix in trace.ts
  seam?: boolean
}

export interface Brush {
  planes: BrushPlane[]
  min: THREE.Vector3
  max: THREE.Vector3
  verts: THREE.Vector3[]
  // faces[i] is a polygon of vert indices lying on planes[i], wound outward
  faces: number[][]
  edges: [number, number][]
}

function plane(nx: number, ny: number, nz: number, point: THREE.Vector3): BrushPlane {
  const n = new THREE.Vector3(nx, ny, nz).normalize()
  return { n, d: n.dot(point) }
}

function boundsOf(verts: THREE.Vector3[]): { min: THREE.Vector3; max: THREE.Vector3 } {
  const min = verts[0].clone()
  const max = verts[0].clone()
  for (const v of verts) {
    min.min(v)
    max.max(v)
  }
  return { min, max }
}

// Fix polygon winding so each face is counterclockwise seen from outside,
// using the brush plane normal as ground truth.
const wa = new THREE.Vector3()
const wb = new THREE.Vector3()
const wn = new THREE.Vector3()
function orientFaces(brush: Brush): void {
  for (let i = 0; i < brush.faces.length; i++) {
    const f = brush.faces[i]
    wa.subVectors(brush.verts[f[1]], brush.verts[f[0]])
    wb.subVectors(brush.verts[f[2]], brush.verts[f[0]])
    wn.crossVectors(wa, wb)
    if (wn.dot(brush.planes[i].n) < 0) f.reverse()
  }
}

// Bevel planes, the same trick Quake map compilers use. Expanding face planes
// by hull extents overestimates the Minkowski sum near sharp edges: a steep
// prism apex grows a phantom solid wedge above the ridge that traps traces.
// Axial planes plus edge bevels (cross of each edge with each axis) make the
// expanded polytope tight. Redundant for point queries, required for hulls.
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
]
const bevelEdge = new THREE.Vector3()
const bevelN = new THREE.Vector3()

function addBevelPlanes(brush: Brush): void {
  const tryAdd = (n: THREE.Vector3): void => {
    for (const p of brush.planes) {
      if (p.n.dot(n) > 0.999) return
    }
    let d = -Infinity
    for (const v of brush.verts) d = Math.max(d, n.dot(v))
    brush.planes.push({ n: n.clone(), d, bevel: true })
  }

  for (const axis of AXES) {
    tryAdd(bevelN.copy(axis))
    tryAdd(bevelN.copy(axis).negate())
  }
  for (const [i, j] of brush.edges) {
    bevelEdge.subVectors(brush.verts[j], brush.verts[i]).normalize()
    for (const axis of AXES) {
      bevelN.crossVectors(bevelEdge, axis)
      if (bevelN.lengthSq() < 1e-6) continue
      bevelN.normalize()
      tryAdd(bevelN)
      tryAdd(bevelN.negate())
    }
  }
}

export function boxBrush(min: THREE.Vector3, max: THREE.Vector3): Brush {
  const verts = [
    new THREE.Vector3(min.x, min.y, min.z), // 0
    new THREE.Vector3(max.x, min.y, min.z), // 1
    new THREE.Vector3(max.x, min.y, max.z), // 2
    new THREE.Vector3(min.x, min.y, max.z), // 3
    new THREE.Vector3(min.x, max.y, min.z), // 4
    new THREE.Vector3(max.x, max.y, min.z), // 5
    new THREE.Vector3(max.x, max.y, max.z), // 6
    new THREE.Vector3(min.x, max.y, max.z), // 7
  ]
  const planes = [
    plane(-1, 0, 0, min),
    plane(1, 0, 0, max),
    plane(0, -1, 0, min),
    plane(0, 1, 0, max),
    plane(0, 0, -1, min),
    plane(0, 0, 1, max),
  ]
  const faces = [
    [0, 3, 7, 4], // -x
    [1, 2, 6, 5], // +x
    [0, 1, 2, 3], // -y
    [4, 5, 6, 7], // +y
    [0, 1, 5, 4], // -z
    [2, 3, 7, 6], // +z
  ]
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const brush: Brush = { planes, verts, faces, edges, ...boundsOf(verts) }
  orientFaces(brush)
  addBevelPlanes(brush)
  return brush
}

// Triangular prism: cross section triangle (a, b, c) extruded along axis by length.
// This is the surf ramp primitive; curves are chains of short prisms.
export function prismBrush(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  axis: THREE.Vector3,
  length: number,
): Brush {
  const dir = axis.clone().normalize()
  const off = dir.clone().multiplyScalar(length)
  const verts = [
    a.clone(), b.clone(), c.clone(),
    a.clone().add(off), b.clone().add(off), c.clone().add(off),
  ]

  const planes: BrushPlane[] = []
  const faces: number[][] = []

  // caps
  planes.push({ n: dir.clone().negate(), d: dir.clone().negate().dot(a) })
  faces.push([0, 1, 2])
  planes.push({ n: dir.clone(), d: dir.dot(verts[3]) })
  faces.push([3, 4, 5])

  // sides: edge (i, j) with opposite vertex k
  const sides: [number, number, number][] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ]
  for (const [i, j, k] of sides) {
    const edge = verts[j].clone().sub(verts[i])
    const n = edge.cross(dir).normalize()
    // orient outward: the opposite vertex must be behind the plane
    if (n.dot(verts[k]) - n.dot(verts[i]) > 0) n.negate()
    planes.push({ n, d: n.dot(verts[i]) })
    faces.push([i, j, j + 3, i + 3])
  }

  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 0],
    [3, 4], [4, 5], [5, 3],
    [0, 3], [1, 4], [2, 5],
  ]
  const brush: Brush = { planes, verts, faces, edges, ...boundsOf(verts) }
  orientFaces(brush)
  addBevelPlanes(brush)
  return brush
}

// Convex hull of a small point set (brute force, generation time only).
// Used for ramp wedge pieces: consecutive pieces share their exact seam
// cross-section, so joints are flush and no internal walls are ever exposed.
export function hullBrush(pts: THREE.Vector3[]): Brush {
  const EPS = 1e-3
  const planes: BrushPlane[] = []
  const faces: number[][] = []
  const ea = new THREE.Vector3()
  const eb = new THREE.Vector3()

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        ea.subVectors(pts[j], pts[i])
        eb.subVectors(pts[k], pts[i])
        const n = new THREE.Vector3().crossVectors(ea, eb)
        if (n.lengthSq() < 1e-8) continue
        n.normalize()
        let d = n.dot(pts[i])
        let above = 0
        let below = 0
        for (const p of pts) {
          const dd = n.dot(p) - d
          if (dd > EPS) above++
          else if (dd < -EPS) below++
        }
        if (above > 0 && below > 0) continue
        if (above > 0) {
          n.negate()
          d = -d
        }
        if (planes.some((pl) => pl.n.dot(n) > 0.9999 && Math.abs(pl.d - d) < 0.05)) continue

        // face polygon: points on the plane, ordered around their centroid
        const on: number[] = []
        for (let m = 0; m < pts.length; m++) {
          if (Math.abs(n.dot(pts[m]) - d) <= EPS) on.push(m)
        }
        if (on.length < 3) continue
        const cx = on.reduce((s, m) => s + pts[m].x, 0) / on.length
        const cy = on.reduce((s, m) => s + pts[m].y, 0) / on.length
        const cz = on.reduce((s, m) => s + pts[m].z, 0) / on.length
        const u = ea.copy(pts[on[0]]).sub(new THREE.Vector3(cx, cy, cz)).normalize().clone()
        const v = new THREE.Vector3().crossVectors(n, u)
        on.sort((m1, m2) => {
          const a1 = Math.atan2(
            (pts[m1].x - cx) * v.x + (pts[m1].y - cy) * v.y + (pts[m1].z - cz) * v.z,
            (pts[m1].x - cx) * u.x + (pts[m1].y - cy) * u.y + (pts[m1].z - cz) * u.z,
          )
          const a2 = Math.atan2(
            (pts[m2].x - cx) * v.x + (pts[m2].y - cy) * v.y + (pts[m2].z - cz) * v.z,
            (pts[m2].x - cx) * u.x + (pts[m2].y - cy) * u.y + (pts[m2].z - cz) * u.z,
          )
          return a1 - a2
        })
        planes.push({ n, d })
        faces.push(on)
      }
    }
  }

  // edges from face polygon boundaries, deduped
  const edgeSet = new Set<number>()
  const edges: [number, number][] = []
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const key = a < b ? a * 64 + b : b * 64 + a
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        edges.push(a < b ? [a, b] : [b, a])
      }
    }
  }

  const verts = pts.map((p) => p.clone())
  const brush: Brush = { planes, verts, faces, edges, ...boundsOf(verts) }
  orientFaces(brush)
  addBevelPlanes(brush)
  return brush
}

// Triangulated geometry built from the brush itself, so visuals match collision.
export function brushGeometry(brush: Brush): THREE.BufferGeometry {
  const positions: number[] = []
  for (const f of brush.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      for (const idx of [f[0], f[i], f[i + 1]]) {
        const v = brush.verts[idx]
        positions.push(v.x, v.y, v.z)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export function brushWireframe(brush: Brush): THREE.BufferGeometry {
  const positions: number[] = []
  for (const [i, j] of brush.edges) {
    positions.push(
      brush.verts[i].x, brush.verts[i].y, brush.verts[i].z,
      brush.verts[j].x, brush.verts[j].y, brush.verts[j].z,
    )
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geo
}
