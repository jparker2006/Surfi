import * as THREE from 'three'
import { brushGeometry, type Brush } from '../physics/brushes'
import { buildSegment, type Cursor, type Segment, type SegmentKind, type SpinePoint } from './segments'
import type { GenerationConfig } from '../../levels/types'

// Level-agnostic course streamer. Generates segments ahead of the player,
// despawns behind, and owns the flat collision brush array plus the spine
// polyline used for distance scoring and the kill height.

const GEN_AHEAD = 7000
const DESPAWN_BEHIND = 2500

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface ActiveSegment {
  segment: Segment
  meshes: THREE.Mesh[]
  // stable monotonic id (never reused while the run lives), for the debug readout
  id: number
}

const segDir = new THREE.Vector3()
const toPlayer = new THREE.Vector3()

export class CourseGenerator {
  readonly group = new THREE.Group()
  // flat collision array: static brushes (spawn platform) plus live segments
  collision: Brush[] = []

  private readonly cfg: GenerationConfig
  private readonly material: THREE.Material
  private readonly statics: Brush[] = []
  private segments: ActiveSegment[] = []
  private spine: SpinePoint[] = []
  private cursor: Cursor = {
    pos: new THREE.Vector3(),
    heading: 0,
    dist: 0,
    dims: { halfWidth: 0, height: 0 },
  }
  private rng: () => number = mulberry32(1)
  private segmentCount = 0
  private readonly spawnRidge: THREE.Vector3

  constructor(cfg: GenerationConfig, material: THREE.Material, spawnRidge: THREE.Vector3) {
    this.cfg = cfg
    this.material = material
    this.spawnRidge = spawnRidge.clone()
  }

  addStatic(brush: Brush): void {
    this.statics.push(brush)
    this.rebuildCollision()
  }

  reset(seed: number): void {
    for (const s of this.segments) {
      for (const m of s.meshes) {
        this.group.remove(m)
        m.geometry.dispose()
      }
    }
    this.segments = []
    this.spine = []
    this.segmentCount = 0
    this.rng = mulberry32(seed)
    this.cursor.pos.copy(this.spawnRidge)
    this.cursor.heading = 0
    this.cursor.dist = 0
    // the opener always uses the easiest dimensions
    this.cursor.dims = {
      halfWidth: this.cfg.rampHalfWidth.max,
      height: this.cfg.rampHeight.max,
    }
    this.rebuildCollision()
    this.ensure(0)
  }

  // keep GEN_AHEAD of course generated past the given progress, drop segments
  // far behind it
  ensure(progress: number): void {
    let changed = false
    while (this.cursor.dist < progress + GEN_AHEAD) {
      this.genNext()
      changed = true
    }
    while (this.segments.length > 0 && this.segments[0].segment.endCum < progress - DESPAWN_BEHIND) {
      const dead = this.segments.shift()!
      for (const m of dead.meshes) {
        this.group.remove(m)
        m.geometry.dispose()
      }
      changed = true
    }
    if (changed) this.rebuildCollision()
  }

  private genNext(): void {
    const isOpener = this.segmentCount === 0
    const id = this.segmentCount
    const kind = this.pickKind()
    const segment = buildSegment(kind, this.cursor, this.cfg, this.rng, isOpener)
    this.segmentCount++

    const meshes: THREE.Mesh[] = []
    for (const brush of segment.brushes) {
      const mesh = new THREE.Mesh(brushGeometry(brush), this.material)
      this.group.add(mesh)
      meshes.push(mesh)
    }
    this.segments.push({ segment, meshes, id })
    for (const p of segment.spine) {
      const last = this.spine[this.spine.length - 1]
      if (!last || p.cum > last.cum) this.spine.push(p)
    }
  }

  private pickKind(): SegmentKind {
    const w = this.cfg.weights
    const gapOk = this.cursor.dist >= this.cfg.gapMinDistance
    const total = w.straight + w.curve + w.spine + (gapOk ? w.gap : 0)
    let r = this.rng() * total
    if ((r -= w.straight) < 0) return 'straight'
    if ((r -= w.curve) < 0) return 'curve'
    if (gapOk && (r -= w.gap) < 0) return 'gap'
    return 'spine'
  }

  private rebuildCollision(): void {
    this.collision = [...this.statics]
    for (const s of this.segments) this.collision.push(...s.segment.brushes)
  }

  // Project the player onto the spine polyline near the given index. Returns
  // course distance, the advanced index, and the spine point for kill checks.
  // Horizontal (xz) projection; the search window keeps it cheap and local.
  progress(pos: THREE.Vector3, fromIndex: number): { dist: number; index: number; killY: number } {
    const pts = this.spine
    const lo = Math.max(0, fromIndex - 1)
    const hi = Math.min(pts.length - 2, fromIndex + 24)
    let bestDist = 0
    let bestIndex = fromIndex
    let bestLateral = Infinity
    let bestKillY = pts.length > 0 ? pts[Math.min(fromIndex, pts.length - 1)].killY : -Infinity

    for (let i = lo; i <= hi; i++) {
      const p0 = pts[i]
      const p1 = pts[i + 1]
      segDir.subVectors(p1.pos, p0.pos)
      segDir.y = 0
      const segLenSq = segDir.lengthSq()
      if (segLenSq < 1e-6) continue
      toPlayer.subVectors(pos, p0.pos)
      toPlayer.y = 0
      const t = THREE.MathUtils.clamp(toPlayer.dot(segDir) / segLenSq, 0, 1)
      const lx = toPlayer.x - segDir.x * t
      const lz = toPlayer.z - segDir.z * t
      const lateral = lx * lx + lz * lz
      if (lateral < bestLateral) {
        bestLateral = lateral
        bestIndex = i
        bestDist = p0.cum + (p1.cum - p0.cum) * t
        bestKillY = Math.min(p0.killY, p1.killY)
      }
    }
    return { dist: bestDist, index: bestIndex, killY: bestKillY }
  }

  // Active segment containing a course distance: its kind (straight, curve,
  // spine, gap) and stable id. Debug readout only, so a linear scan over the
  // handful of live segments is fine.
  segmentAt(dist: number): { kind: SegmentKind; id: number } | null {
    for (const s of this.segments) {
      const start = s.segment.spine.length > 0 ? s.segment.spine[0].cum : 0
      if (dist >= start && dist <= s.segment.endCum) return { kind: s.segment.kind, id: s.id }
    }
    return null
  }

  // Unit xz direction of the course at a spine index, pointing toward
  // increasing distance. The anomaly recorder dots player velocity against
  // this to detect backward (down-course) drift.
  spineDirAt(index: number): { x: number; z: number } {
    const pts = this.spine
    if (pts.length < 2) return { x: 0, z: 0 }
    const i = Math.max(0, Math.min(pts.length - 2, index))
    const dx = pts[i + 1].pos.x - pts[i].pos.x
    const dz = pts[i + 1].pos.z - pts[i].pos.z
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return { x: 0, z: 0 }
    return { x: dx / len, z: dz / len }
  }

  // spine point at a given course distance, for the test bot
  spineAt(cum: number): { x: number; y: number; z: number; heading: number } | null {
    const pts = this.spine
    if (pts.length < 2) return null
    let i = 0
    while (i < pts.length - 2 && pts[i + 1].cum < cum) i++
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const span = Math.max(1e-6, p1.cum - p0.cum)
    const t = THREE.MathUtils.clamp((cum - p0.cum) / span, 0, 1)
    return {
      x: p0.pos.x + (p1.pos.x - p0.pos.x) * t,
      y: p0.pos.y + (p1.pos.y - p0.pos.y) * t,
      z: p0.pos.z + (p1.pos.z - p0.pos.z) * t,
      heading: Math.atan2(-(p1.pos.x - p0.pos.x), -(p1.pos.z - p0.pos.z)),
    }
  }
}
