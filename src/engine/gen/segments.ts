import * as THREE from 'three'
import { hullBrush, type Brush } from '../physics/brushes'
import { evalParam, type GenerationConfig } from '../../levels/types'

// Segment builders. Every ramp piece is the convex hull of two triangular
// cross-sections, and consecutive pieces share their seam cross-section
// exactly. Flush joints matter: any overlap or mismatch exposes internal
// brush walls that stop a rider dead.

export interface SpinePoint {
  pos: THREE.Vector3
  // falling below this height near this point kills the player
  killY: number
  // cumulative course distance at this point
  cum: number
}

export interface Dims {
  halfWidth: number
  height: number
}

export interface Cursor {
  pos: THREE.Vector3
  heading: number
  dist: number
  dims: Dims
}

export type SegmentKind = 'straight' | 'curve' | 'gap' | 'spine'

export interface Segment {
  kind: SegmentKind
  brushes: Brush[]
  spine: SpinePoint[]
  endCum: number
}

const KILL_DROP = 420

const fwd = new THREE.Vector3()
const right = new THREE.Vector3()
const axis = new THREE.Vector3()

function forwardOf(heading: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.sin(heading), 0, -Math.cos(heading))
}

function rightOf(heading: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(heading), 0, -Math.sin(heading))
}

// apex on the spine, two corners below: the surf ramp cross-section
function crossSection(pos: THREE.Vector3, heading: number, dims: Dims): THREE.Vector3[] {
  rightOf(heading, right)
  const a = pos.clone()
  const b = pos.clone().addScaledVector(right, -dims.halfWidth)
  b.y -= dims.height
  const c = pos.clone().addScaledVector(right, dims.halfWidth)
  c.y -= dims.height
  return [a, b, c]
}

// Advance the cursor by one piece and return the hull of the two seam
// cross-sections. The heading rotates at the end of the piece, so the next
// piece (or segment) starts from this exact cross-section.
function wedgePiece(
  cursor: Cursor,
  length: number,
  slope: number,
  headingDelta: number,
  endDims: Dims,
): Brush {
  const tri1 = crossSection(cursor.pos, cursor.heading, cursor.dims)
  forwardOf(cursor.heading, fwd)
  axis.set(fwd.x, -slope, fwd.z).normalize()
  cursor.pos.addScaledVector(axis, length * Math.sqrt(1 + slope * slope))
  cursor.dist += length
  cursor.heading += headingDelta
  cursor.dims = endDims
  const tri2 = crossSection(cursor.pos, cursor.heading, endDims)
  const brush = hullBrush([...tri1, ...tri2])
  // mark the near-vertical cap planes as seams: they sit flush against the
  // neighboring piece and must never act as walls for a rider on the surface
  for (const pl of brush.planes) {
    if (!pl.bevel && Math.abs(pl.n.y) < 0.35) pl.seam = true
  }
  return brush
}

function spinePointAt(cursor: Cursor): SpinePoint {
  return {
    pos: cursor.pos.clone(),
    killY: cursor.pos.y - cursor.dims.height - KILL_DROP,
    cum: cursor.dist,
  }
}

export function buildSegment(
  kind: SegmentKind,
  cursor: Cursor,
  cfg: GenerationConfig,
  rand: () => number,
  isOpener: boolean,
): Segment {
  const d = cursor.dist
  const slope = evalParam(cfg.descentSlope, d)
  let length = evalParam(cfg.segmentLength, d) * (0.8 + 0.4 * rand())

  if (isOpener) {
    kind = 'straight'
    length = cfg.openerLength
  }

  // difficulty target for the end of this segment; pieces interpolate so the
  // cross-section stays continuous across every seam
  const endDims: Dims = {
    halfWidth: evalParam(cfg.rampHalfWidth, d + length),
    height: evalParam(cfg.rampHeight, d + length),
  }
  const startDims = cursor.dims

  const brushes: Brush[] = []
  const spine: SpinePoint[] = [spinePointAt(cursor)]

  const lerpDims = (t: number): Dims => ({
    halfWidth: startDims.halfWidth + (endDims.halfWidth - startDims.halfWidth) * t,
    height: startDims.height + (endDims.height - startDims.height) * t,
  })

  switch (kind) {
    case 'straight': {
      brushes.push(wedgePiece(cursor, length, slope, 0, endDims))
      spine.push(spinePointAt(cursor))
      break
    }

    case 'spine': {
      // flare out to a wide ridge surfable on both faces, then back in
      const wide: Dims = { halfWidth: endDims.halfWidth * 1.7, height: endDims.height * 1.15 }
      brushes.push(wedgePiece(cursor, length * 0.35, slope, 0, wide))
      spine.push(spinePointAt(cursor))
      brushes.push(wedgePiece(cursor, length * 0.3, slope, 0, wide))
      spine.push(spinePointAt(cursor))
      brushes.push(wedgePiece(cursor, length * 0.35, slope, 0, endDims))
      spine.push(spinePointAt(cursor))
      break
    }

    case 'curve': {
      // 5 degree pieces: a rider crossing each seam stays within the
      // controller's duplicate-plane tolerance, no crease, no speed loss
      const total = THREE.MathUtils.degToRad(evalParam(cfg.curveAngleDeg, d)) * (rand() < 0.5 ? 1 : -1)
      const pieces = Math.max(2, Math.ceil(Math.abs(total) / THREE.MathUtils.degToRad(5)))
      const delta = total / pieces
      const pieceLen = length / pieces
      for (let i = 0; i < pieces; i++) {
        brushes.push(wedgePiece(cursor, pieceLen, slope, delta, lerpDims((i + 1) / pieces)))
        spine.push(spinePointAt(cursor))
      }
      break
    }

    case 'gap': {
      // entry ramp, then a jump the player clears with carried speed
      const gap = evalParam(cfg.gapSize, d)
      const entryLen = Math.max(500, length - gap)
      brushes.push(wedgePiece(cursor, entryLen, slope, 0, endDims))
      spine.push(spinePointAt(cursor))
      // cursor flies the gap: forward plus a generous drop so speed clears it
      forwardOf(cursor.heading, fwd)
      cursor.pos.addScaledVector(fwd, gap)
      cursor.pos.y -= gap * 0.5 + 80
      cursor.dist += gap
      spine.push(spinePointAt(cursor))
      break
    }
  }

  return { kind, brushes, spine, endCum: cursor.dist }
}
