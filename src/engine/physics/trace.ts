import * as THREE from 'three'
import type { Brush } from './brushes'

// Swept AABB trace against convex brushes, ported from the Quake/Source
// CM_ClipBoxToBrush approach: expand each brush plane by the hull support
// extent, then clip the center-point ray against the expanded polytope.

const DIST_EPS = 0.03125
// Sub-epsilon penetration counts as surface contact, not solid. Sliding along
// a crease (two-face ridge apex) drifts the hull a float-noise distance inside
// both planes; without this the trace reports allSolid and the player freezes.
const SOLID_EPS = 0.1
// A bevel/seam at or above this normal.y is cap-like (a near horizontal Minkowski
// roof over a convex apex), not wall-like. The rampbug redirect leaves those
// alone so the hull clips against them and rides along the crest; see below.
const CAP_NORMAL_Y = 0.7

export interface TraceResult {
  fraction: number
  endPos: THREE.Vector3
  normal: THREE.Vector3
  hit: boolean
  hitBevel: boolean
  // the chosen contact plane was a seam cap. Diagnostic only (the anomaly
  // recorder classifies what a rider got stuck against); physics ignores it.
  hitSeam: boolean
  // the plane that actually limited the sweep fraction, BEFORE the rampbug
  // redirect moved the clip normal to a real face. This is the surface the hull
  // is physically jammed against; tryPlayerMove uses it to unstick a wedge.
  blockerNormal: THREE.Vector3
  startSolid: boolean
  allSolid: boolean
}

export function createTraceResult(): TraceResult {
  return {
    fraction: 1,
    endPos: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    hit: false,
    hitBevel: false,
    hitSeam: false,
    blockerNormal: new THREE.Vector3(),
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
  out.hitBevel = false
  out.hitSeam = false
  out.blockerNormal.set(0, 0, 0)
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
  // rampbug fix bookkeeping: where the sweep started relative to the brush's
  // real surface planes (non-seam, non-bevel)
  let faceMaxD1 = -Infinity
  let nearestFace = -1

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
    if (d1 > -SOLID_EPS) startOut = true

    if (!planes[i].seam && !planes[i].bevel && d1 > faceMaxD1) {
      faceMaxD1 = d1
      nearestFace = i
    }

    // completely in front of this face: no intersection with the brush
    if (d1 > 0 && (d2 >= DIST_EPS || d2 >= d1)) return
    // completely behind this face: does not constrain the sweep
    if (d1 <= -SOLID_EPS && d2 <= 0) continue
    if (d1 <= 0 && d2 <= 0 && d2 >= d1) continue

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
    let chosen = clipPlane
    // Rampbug fix. A bevel plane is not a real surface: it only tightens the
    // swept hull polytope at sharp edges. A seam cap is the flush end face of a
    // ramp piece. Neither should ever clip a rider's velocity, but the swept
    // trace can "enter" the brush through one of them and report it as a head-on
    // wall, stealing surf speed (the contact normal points across the course).
    // Whenever the brush has a real face, the geometrically correct contact is
    // the nearest one, so clip against that instead. The bevel/seam still bounds
    // the sweep fraction (the hull stops in the right place); only the clip
    // normal moves to the real surface.
    //
    // This used to be gated on faceMaxD1 <= 0.5 (the hull within 0.5u of a real
    // face, i.e. already on the surface). That missed the apex landing: a rider
    // surfing high drops onto the ridge from a tick of air, so the hull starts
    // above the faces (faceMaxD1 > 0.5) and the old guard let an apex edge bevel
    // through as a wall. Reporting the nearest real face is correct on the
    // surface and above it (the rider is landing onto that face); the gate is gone.
    //
    // The redirect must NOT fire for a cap-like bevel, though: a near horizontal
    // Minkowski roof over the apex (normal.y >= CAP_NORMAL_Y) is the local floor
    // the hull rests on when it is balanced on the ridge crest. Redirecting that
    // to a steep side face leaves the downward (into-cap) velocity unclipped, so
    // the hull presses into the cap, the swept move stays bevel-bounded at
    // fraction 0, and tryPlayerMove pumps velocity unbounded while the position
    // is frozen (the apex freeze a human hits riding up to the very top). Clipping
    // against the cap instead sheds the into-cap component, so the hull rides
    // along the crest. Only steep, across-course bevels/seams are wall-like.
    const p = planes[chosen]
    const wallLike = (p.seam === true || p.bevel === true) && p.n.y < CAP_NORMAL_Y
    if (wallLike && nearestFace >= 0) {
      chosen = nearestFace
    }
    out.fraction = enterFrac
    out.normal.copy(planes[chosen].n)
    // the real fraction-limiting plane, before the redirect: what the hull is
    // physically jammed against if it cannot move
    out.blockerNormal.copy(planes[clipPlane].n)
    out.hit = true
    out.hitBevel = planes[chosen].bevel === true
    out.hitSeam = planes[chosen].seam === true
  }
}
