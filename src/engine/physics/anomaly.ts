import type { PlayerController, InputFrame } from './controller'
import type { CourseGenerator } from '../gen/generator'
import { consts } from './constants'

// Anomaly recorder, dev/test only. Fed once per physics tick after the course
// progress is known, it keeps a rolling 120 tick window of full state and, when
// a detector fires, snapshots that window so the trap can be reconstructed and
// turned into a deterministic regression. It never runs in a plain prod load.
//
// Detectors (the trap surfaces as one or more of these while the player is in
// contact with a surface):
//   a. horizontal speed drops more than 15% in one tick on a surf face: stuck
//   b. velocity along the course spine goes negative: backward drift
//   c. two or more simultaneous clip planes: a corner/crease
//   d. start-solid: the hull began a move already penetrating a brush
//   e. stuck-high: arrested high on a face near the ridge apex, where the bevel
//      redirect's faceMaxD1 gate stops firing (the apex coverage hole)
//   f. stuck-on-steep: arrested against a face whose normal points up-course
//      (a wall facing back into the player, stealing along-course speed)
//   g. held-high: mechanism-agnostic. Horizontal speed held low for a sustained
//      run of ticks WHILE in contact (grounded or clipped) and high on the ridge,
//      regardless of cause. a..f are one-tick clip signatures and miss a gradual
//      grounding-plus-friction crawl or a strafe-in hold at the apex; g catches
//      those. A decaying recentPeak gates out a standstill (the spawn platform):
//      the stick is always preceded by real surf speed.
// e..g are evaluated before a..d so the more specific apex/steep/held stick is
// the label when one fires; they are what humans hit and the clean/sloppy bots
// miss.

const RING = 180
// detector g: consecutive held-slow ticks (about 0.6s at 64 tick) before it fires
const HELD_TICKS = 40
// detector g speed gates: "held" means below this while a recent peak proves the
// player was genuinely surfing first
const HELD_SPEED = 180
const HELD_RECENT_PEAK = 400
// recentPeak decay per tick (half-life about 3.6s). Slow on purpose: a grounding
// plus friction crawl can take a couple of seconds to bleed out, and the detector
// must still remember the player was fast when the held run finally completes.
const HELD_DECAY = 0.997
const SURF_NORMAL_Y = 0.7
const MAX_DUMPS = 60
// after a trigger, wait this many ticks before arming again, so a single trap
// does not emit a dump every tick for its whole duration
const COOLDOWN = 90

const PLANES_PER_FRAME = 5

interface Frame {
  tickId: number
  px: number; py: number; pz: number
  vx: number; vy: number; vz: number
  fwd: boolean; back: boolean; left: boolean; right: boolean; jump: boolean
  yaw: number; pitch: number
  planeCount: number
  // flattened nx,ny,nz per plane (PLANES_PER_FRAME * 3), valid up to planeCount
  planeN: Float64Array
  startSolid: boolean
  allSolid: boolean
  horizBefore: number
  horizAfter: number
  stopReason: string
  onSurfPlane: boolean
  grounded: boolean
  dist: number
  alongVel: number
  // the steep contact normal the surfer clipped against this tick (zero length
  // if none), and how the trace classified it
  cnx: number; cny: number; cnz: number
  cbevel: boolean; cseam: boolean
  // height of the rider below the spine apex at this tick (apexY - py)
  belowApex: number
  // what the engine thinks the player is on this tick, and which segment
  surfaceClass: string // 'air' | 'surf' | 'ground'
  segKind: string
  segId: number
}

function makeFrame(): Frame {
  return {
    tickId: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
    fwd: false, back: false, left: false, right: false, jump: false,
    yaw: 0, pitch: 0,
    planeCount: 0, planeN: new Float64Array(PLANES_PER_FRAME * 3),
    startSolid: false, allSolid: false, horizBefore: 0, horizAfter: 0,
    stopReason: '', onSurfPlane: false, grounded: false, dist: 0, alongVel: 0,
    cnx: 0, cny: 0, cnz: 0, cbevel: false, cseam: false, belowApex: 0,
    surfaceClass: 'air', segKind: '', segId: -1,
  }
}

export interface AnomalyFrame {
  tickId: number
  pos: [number, number, number]
  vel: [number, number, number]
  input: { fwd: boolean; back: boolean; left: boolean; right: boolean; jump: boolean; yaw: number; pitch: number }
  planeCount: number
  planeNormals: [number, number, number][]
  startSolid: boolean
  allSolid: boolean
  horizBefore: number
  horizAfter: number
  stopReason: string
  onSurfPlane: boolean
  grounded: boolean
  dist: number
  alongVel: number
  contactNormal: [number, number, number]
  contactBevel: boolean
  contactSeam: boolean
  belowApex: number
  surfaceClass: string
  segKind: string
  segId: number
}

export interface AnomalyDump {
  trigger: 'speeddrop' | 'backdrift' | 'multiplane' | 'startsolid' | 'stuckhigh' | 'stuckonsteep' | 'heldhigh'
  seed: number
  atTickId: number
  // dist and alongVel at the trigger, the headline numbers for triage
  dist: number
  alongVel: number
  horizBefore: number
  horizAfter: number
  frames: AnomalyFrame[]
}

export class AnomalyRecorder {
  enabled = false
  seed = 0
  readonly dumps: AnomalyDump[] = []
  // running tallies for the sweep gate, per detector. eyeclip counts ticks
  // where the camera eye sits inside (or within the near plane of) brush
  // geometry: the cause of the flash on the old pinned-against-a-wall trap.
  readonly counts = { speeddrop: 0, backdrift: 0, multiplane: 0, startsolid: 0, stuckhigh: 0, stuckonsteep: 0, heldhigh: 0, eyeclip: 0 }

  private readonly ring: Frame[] = []
  private head = 0
  private filled = 0
  private tickId = 0
  private spineIndex = 0
  private cooldown = 0
  // separate cooldown for the apex/steep trap dumps, so they capture plane
  // configs without disturbing the a..d dump cadence
  private trapCooldown = 0
  // detector g state: a run of held-slow ticks, and a decaying peak speed that
  // proves the player was surfing before the stall (so a standstill never fires)
  private heldStreak = 0
  private recentPeak = 0

  constructor() {
    for (let i = 0; i < RING; i++) this.ring.push(makeFrame())
  }

  reset(seed: number): void {
    this.seed = seed
    this.head = 0
    this.filled = 0
    this.tickId = 0
    this.spineIndex = 0
    this.cooldown = 0
    this.trapCooldown = 0
    this.heldStreak = 0
    this.recentPeak = 0
    this.dumps.length = 0
    this.counts.speeddrop = 0
    this.counts.backdrift = 0
    this.counts.multiplane = 0
    this.counts.startsolid = 0
    this.counts.stuckhigh = 0
    this.counts.stuckonsteep = 0
    this.counts.heldhigh = 0
    this.counts.eyeclip = 0
  }

  // Is the camera eye inside, or within the near plane of, the rendered solid
  // of any nearby brush? If so the near plane would slice through a face and
  // the player would see past the geometry: the flash. Real faces (non bevel)
  // define the rendered solid; the eye is inside when it is behind all of them.
  private eyeClipped(controller: PlayerController, gen: CourseGenerator): boolean {
    const eyeOffset = consts.eyeHeight - consts.hullHeight / 2
    const ex = controller.pos.x
    const ey = controller.pos.y + eyeOffset
    const ez = controller.pos.z
    const margin = 1 // the camera near plane, in units
    const col = gen.collision
    for (let i = 0; i < col.length; i++) {
      const b = col[i]
      if (ex < b.min.x - margin || ex > b.max.x + margin) continue
      if (ey < b.min.y - margin || ey > b.max.y + margin) continue
      if (ez < b.min.z - margin || ez > b.max.z + margin) continue
      let inside = true
      for (const p of b.planes) {
        if (p.bevel) continue
        if (p.n.x * ex + p.n.y * ey + p.n.z * ez - p.d > margin) { inside = false; break }
      }
      if (inside) return true
    }
    return false
  }

  // Called once per physics tick, after the controller moved and the course
  // progress was computed. Records the frame, then evaluates the detectors.
  sample(controller: PlayerController, input: InputFrame, gen: CourseGenerator): void {
    if (!this.enabled) return
    const d = controller.diag

    const prog = gen.progress(controller.pos, this.spineIndex)
    this.spineIndex = prog.index
    const dir = gen.spineDirAt(prog.index)
    const alongVel = controller.vel.x * dir.x + controller.vel.z * dir.z
    // height of the rider below the spine apex (the spine rides the ridge crest)
    const apex = gen.spineAt(prog.dist)
    const belowApex = apex ? apex.y - controller.pos.y : 1e9
    // what the engine thinks the player is on, and which segment they are in
    const seg = gen.segmentAt(prog.dist)
    const surfaceClass = d.grounded ? 'ground' : d.onSurfPlane ? 'surf' : 'air'

    const f = this.ring[this.head]
    f.tickId = this.tickId
    f.px = controller.pos.x; f.py = controller.pos.y; f.pz = controller.pos.z
    f.vx = controller.vel.x; f.vy = controller.vel.y; f.vz = controller.vel.z
    f.fwd = input.forward; f.back = input.back; f.left = input.left
    f.right = input.right; f.jump = input.jump; f.yaw = input.yaw; f.pitch = input.pitch
    f.planeCount = d.planeCount
    for (let p = 0; p < d.planeCount && p < PLANES_PER_FRAME; p++) {
      f.planeN[p * 3] = d.planes[p].x
      f.planeN[p * 3 + 1] = d.planes[p].y
      f.planeN[p * 3 + 2] = d.planes[p].z
    }
    f.startSolid = d.startSolid; f.allSolid = d.allSolid
    f.horizBefore = d.horizBefore; f.horizAfter = d.horizAfter
    f.stopReason = d.stopReason; f.onSurfPlane = d.onSurfPlane; f.grounded = d.grounded
    f.dist = prog.dist; f.alongVel = alongVel
    f.cnx = d.contactNormal.x; f.cny = d.contactNormal.y; f.cnz = d.contactNormal.z
    f.cbevel = d.contactBevel; f.cseam = d.contactSeam
    f.belowApex = belowApex
    f.surfaceClass = surfaceClass
    f.segKind = seg ? seg.kind : ''
    f.segId = seg ? seg.id : -1

    this.head = (this.head + 1) % RING
    if (this.filled < RING) this.filled++
    this.tickId++

    // flash signal: tally every tick the eye is inside geometry, independent of
    // the trap detectors and their cooldown
    if (this.eyeClipped(controller, gen)) this.counts.eyeclip++

    // "in contact" means touching a steep face or accumulating a clip plane.
    // Flat ground is excluded so ordinary friction never counts as stuck.
    const surfContact = d.onSurfPlane || d.planeCount > 0

    // e + f: the apex/steep sticks humans hit. Tallied every tick (like eyeclip)
    // and given their own dump cadence, so they never disturb the a..d counts the
    // existing clean/sloppy gates read. "Arrested" is a real >15% one-tick speed
    // loss while the rider was moving.
    const cLenSq =
      d.contactNormal.x * d.contactNormal.x +
      d.contactNormal.y * d.contactNormal.y +
      d.contactNormal.z * d.contactNormal.z
    const arrested = d.horizBefore > 150 && d.horizAfter < d.horizBefore * 0.85
    let trap: 'stuckonsteep' | 'stuckhigh' | '' = ''
    if (
      surfContact && arrested && cLenSq > 0.5 && d.contactNormal.y < SURF_NORMAL_Y &&
      d.contactNormal.x * dir.x + d.contactNormal.z * dir.z < -0.15
    ) {
      // f. clipped against a face whose normal points back up-course
      trap = 'stuckonsteep'
    } else if (surfContact && arrested && belowApex < 110 && alongVel < 60) {
      // e. arrested high on the face near the ridge apex
      trap = 'stuckhigh'
    }
    if (trap) {
      this.counts[trap]++
      if (this.trapCooldown === 0) {
        this.emit(trap, alongVel, d.horizBefore, d.horizAfter, prog.dist)
        this.trapCooldown = COOLDOWN
      }
    }

    // g. mechanism-agnostic held-high stick. In contact (grounded OR clipped OR
    // on a surf face), high on the ridge, and held below HELD_SPEED for a run of
    // HELD_TICKS, after a recent peak proves the player was actually surfing.
    // This is what a..f miss: a gradual grounding-plus-friction crawl or a
    // strafe-in hold at the apex never shows a single sharp clip, but it leaves
    // the player stalled, so g watches the sustained outcome, not the event.
    const inContact = d.grounded || d.planeCount > 0 || d.onSurfPlane
    this.recentPeak = Math.max(d.horizAfter, this.recentPeak * HELD_DECAY)
    const heldNow =
      inContact && belowApex < 160 && d.horizAfter < HELD_SPEED && this.recentPeak > HELD_RECENT_PEAK
    this.heldStreak = heldNow ? this.heldStreak + 1 : 0
    if (this.heldStreak === HELD_TICKS) {
      this.counts.heldhigh++
      if (this.trapCooldown === 0) {
        this.emit('heldhigh', alongVel, d.horizBefore, d.horizAfter, prog.dist)
        this.trapCooldown = COOLDOWN
      }
    }

    if (this.trapCooldown > 0) this.trapCooldown--

    if (this.cooldown > 0) {
      this.cooldown--
      return
    }

    let trigger: AnomalyDump['trigger'] | '' = ''

    // a. stuck: a sharp one-tick speed loss on a face that leaves the player
    //    crawling along the course. The alongVel gate excludes a legitimate
    //    fast landing (which sheds into-ramp speed but keeps high forward
    //    along-course velocity); the trap leaves you slow or backward.
    if (surfContact && d.horizBefore > 200 && d.horizAfter < d.horizBefore * 0.85 && alongVel < 150) {
      trigger = 'speeddrop'
    } else if (surfContact && alongVel < -15 && d.horizAfter < 120) {
      // b. drifting back down the course while stuck on a surface. The speed
      // gate is what makes this the trap and not a fast landing that briefly
      // carries a backward component while sliding laterally at speed.
      trigger = 'backdrift'
    } else if (d.planeCount >= 2) {
      // c. a two plane (or more) corner: the crease/primal-zero suspect
      trigger = 'multiplane'
    } else if (d.startSolid || d.allSolid) {
      // d. began the move inside a brush
      trigger = 'startsolid'
    }

    if (trigger) {
      this.counts[trigger]++
      this.emit(trigger, alongVel, d.horizBefore, d.horizAfter, prog.dist)
      this.cooldown = COOLDOWN
    }
  }

  // Flatten the ring buffer (oldest first) into serializable frames. Shared by
  // the detector dumps and the manual capture hotkey.
  private buildFrames(): AnomalyFrame[] {
    const frames: AnomalyFrame[] = []
    const start = (this.head - this.filled + RING) % RING
    for (let k = 0; k < this.filled; k++) {
      const f = this.ring[(start + k) % RING]
      const normals: [number, number, number][] = []
      for (let p = 0; p < f.planeCount && p < PLANES_PER_FRAME; p++) {
        normals.push([f.planeN[p * 3], f.planeN[p * 3 + 1], f.planeN[p * 3 + 2]])
      }
      frames.push({
        tickId: f.tickId,
        pos: [f.px, f.py, f.pz],
        vel: [f.vx, f.vy, f.vz],
        input: { fwd: f.fwd, back: f.back, left: f.left, right: f.right, jump: f.jump, yaw: f.yaw, pitch: f.pitch },
        planeCount: f.planeCount,
        planeNormals: normals,
        startSolid: f.startSolid,
        allSolid: f.allSolid,
        horizBefore: f.horizBefore,
        horizAfter: f.horizAfter,
        stopReason: f.stopReason,
        onSurfPlane: f.onSurfPlane,
        grounded: f.grounded,
        dist: f.dist,
        alongVel: f.alongVel,
        contactNormal: [f.cnx, f.cny, f.cnz],
        contactBevel: f.cbevel,
        contactSeam: f.cseam,
        belowApex: f.belowApex,
        surfaceClass: f.surfaceClass,
        segKind: f.segKind,
        segId: f.segId,
      })
    }
    return frames
  }

  // Manual capture (the K hotkey): the full ring up to now, no detector trigger.
  // This is the human-in-the-loop ground truth, dumped the instant they stick.
  snapshot(): { seed: number; atTickId: number; frameCount: number; frames: AnomalyFrame[] } {
    const frames = this.buildFrames()
    return { seed: this.seed, atTickId: this.tickId - 1, frameCount: frames.length, frames }
  }

  private emit(
    trigger: AnomalyDump['trigger'],
    alongVel: number,
    horizBefore: number,
    horizAfter: number,
    dist: number,
  ): void {
    if (this.dumps.length >= MAX_DUMPS) return
    this.dumps.push({
      trigger,
      seed: this.seed,
      atTickId: this.tickId - 1,
      dist,
      alongVel,
      horizBefore,
      horizAfter,
      frames: this.buildFrames(),
    })
  }
}
