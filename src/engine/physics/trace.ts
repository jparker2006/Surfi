import * as THREE from 'three'
import type { Brush } from './brushes'

// Swept AABB trace against convex brushes, ported from the Quake/Source
// CM_ClipBoxToBrush approach: expand each brush plane by the hull support
// extent, then clip the center-point ray against the expanded polytope.

const DIST_EPS = 0.03125

export interface TraceResult {
  fraction: number
  endPos: THREE.Vector3
  normal: THREE.Vector3
  hit: boolean
  startSolid: boolean
  allSolid: boolean
}

export function createTraceResult(): TraceResult {
  return {
    fraction: 1,
    endPos: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    hit: false,
    startSolid: false,
    allSolid: false,
  }
}

const sweptMin = new THREE.Vector3()
const sweptMax = new THREE.Vector3()

export function traceHull(
  start: THREE.Vector3,
  end: THREE.Vector3,
  half: THREE.Vector3,
  brushes: Brush[],
  out: TraceResult,
): void {
  out.fraction = 1
  out.hit = false
  out.startSolid = false
  out.allSolid = false

  sweptMin.set(
    Math.min(start.x, end.x) - half.x - 1,
    Math.min(start.y, end.y) - half.y - 1,
    Math.min(start.z, end.z) - half.z - 1,
  )
  sweptMax.set(
    Math.max(start.x, end.x) + half.x + 1,
    Math.max(start.y, end.y) + half.y + 1,
    Math.max(start.z, end.z) + half.z + 1,
  )

  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i]
    if (
      b.max.x < sweptMin.x || b.min.x > sweptMax.x ||
      b.max.y < sweptMin.y || b.min.y > sweptMax.y ||
      b.max.z < sweptMin.z || b.min.z > sweptMax.z
    ) continue
    clipToBrush(start, end, half, b, out)
    if (out.allSolid) break
  }

  out.endPos.copy(start).lerp(end, out.fraction)
}

function clipToBrush(
  start: THREE.Vector3,
  end: THREE.Vector3,
  half: THREE.Vector3,
  brush: Brush,
  out: TraceResult,
): void {
  let enterFrac = -1
  let leaveFrac = 1
  let clipPlane = -1
  let startOut = false
  let getOut = false

  const planes = brush.planes
  for (let i = 0; i < planes.length; i++) {
    const n = planes[i].n
    const dist =
      planes[i].d +
      Math.abs(n.x) * half.x +
      Math.abs(n.y) * half.y +
      Math.abs(n.z) * half.z
    const d1 = n.x * start.x + n.y * start.y + n.z * start.z - dist
    const d2 = n.x * end.x + n.y * end.y + n.z * end.z - dist

    if (d2 > 0) getOut = true
    if (d1 > 0) startOut = true

    // completely in front of this face: no intersection with the brush
    if (d1 > 0 && (d2 >= DIST_EPS || d2 >= d1)) return
    // completely behind this face: does not constrain the sweep
    if (d1 <= 0 && d2 <= 0) continue

    if (d1 > d2) {
      // entering
      let f = (d1 - DIST_EPS) / (d1 - d2)
      if (f < 0) f = 0
      if (f > enterFrac) {
        enterFrac = f
        clipPlane = i
      }
    } else {
      // leaving
      let f = (d1 + DIST_EPS) / (d1 - d2)
      if (f > 1) f = 1
      if (f < leaveFrac) leaveFrac = f
    }
  }

  if (!startOut) {
    out.startSolid = true
    if (!getOut) {
      out.allSolid = true
      out.fraction = 0
    }
    return
  }

  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < out.fraction) {
    out.fraction = enterFrac
    out.normal.copy(planes[clipPlane].n)
    out.hit = true
  }
}
