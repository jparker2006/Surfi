import * as THREE from 'three'
import { consts } from './constants'
import { traceHull, createTraceResult } from './trace'
import type { Brush } from './brushes'

// The player controller: a port of Source engine movement. Air acceleration
// with the tiny wishspeed cap plus ClipVelocity on ramp contact is what makes
// surf work. Position is the hull center.

export interface InputFrame {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  yaw: number
  pitch: number
}

// Per-tick diagnostics for the anomaly recorder. Populated only while
// controller.recording is true, so the normal tick path stays allocation free
// and branch cheap. planes holds the clip normals at the moment of maximum
// simultaneous accumulation this tick.
export interface TickDiag {
  planeCount: number
  planes: THREE.Vector3[]
  startSolid: boolean
  allSolid: boolean
  horizBefore: number
  horizAfter: number
  stopReason: string
  onSurfPlane: boolean
  grounded: boolean
  // the last steep (n.y < GROUND_NORMAL_Y) contact normal this tick, the face a
  // surfer actually clips against, plus what kind of plane it was. The recorder
  // uses this to classify apex/steep-side sticks. contactNormal is zero length
  // when no steep contact happened this tick.
  contactNormal: THREE.Vector3
  contactBevel: boolean
  contactSeam: boolean
}

const MAX_CLIP_PLANES = 5
const GROUND_NORMAL_Y = 0.7

// scratch, never allocated in the tick path
const wishvel = new THREE.Vector3()
const wishdir = new THREE.Vector3()
const moveEnd = new THREE.Vector3()
const downEnd = new THREE.Vector3()
const originalVel = new THREE.Vector3()
const primalVel = new THREE.Vector3()
const crease = new THREE.Vector3()
const clipped = new THREE.Vector3()
const startMovePos = new THREE.Vector3()
const lastBlocker = new THREE.Vector3()
const planes: THREE.Vector3[] = []
for (let i = 0; i < MAX_CLIP_PLANES; i++) planes.push(new THREE.Vector3())
const tr = createTraceResult()

// Source ClipVelocity with overbounce 1.0, plus the nudge that keeps the
// result from pointing back into the plane. This is what converts gravity
// into speed along a ramp face.
export function clipVelocity(vel: THREE.Vector3, normal: THREE.Vector3, out: THREE.Vector3): void {
  const backoff = vel.dot(normal)
  out.copy(vel).addScaledVector(normal, -backoff)
  const adjust = out.dot(normal)
  if (adjust < 0) out.addScaledVector(normal, -adjust)
}

export class PlayerController {
  pos = new THREE.Vector3()
  vel = new THREE.Vector3()
  grounded = false
  onSurfPlane = false
  stopReason = ''
  readonly half = new THREE.Vector3()

  // dev/test only: when true, tick() fills diag for the anomaly recorder
  recording = false
  readonly diag: TickDiag = {
    planeCount: 0,
    planes: [
      new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(),
      new THREE.Vector3(), new THREE.Vector3(),
    ],
    startSolid: false,
    allSolid: false,
    horizBefore: 0,
    horizAfter: 0,
    stopReason: '',
    onSurfPlane: false,
    grounded: false,
    contactNormal: new THREE.Vector3(),
    contactBevel: false,
    contactSeam: false,
  }

  tick(input: InputFrame, brushes: Brush[], dt: number): void {
    this.half.set(consts.hullWidth / 2, consts.hullHeight / 2, consts.hullWidth / 2)
    this.onSurfPlane = false

    if (this.recording) {
      this.diag.planeCount = 0
      this.diag.startSolid = false
      this.diag.allSolid = false
      this.diag.horizBefore = Math.hypot(this.vel.x, this.vel.z)
      this.diag.contactNormal.set(0, 0, 0)
      this.diag.contactBevel = false
      this.diag.contactSeam = false
    }

    // wishdir: horizontal input direction rotated by view yaw
    const fmove = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
    const smove = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    const sy = Math.sin(input.yaw)
    const cy = Math.cos(input.yaw)
    // forward = (-sy, 0, -cy), right = (cy, 0, -sy)
    wishvel.set(
      -sy * fmove + cy * smove,
      0,
      -cy * fmove - sy * smove,
    ).multiplyScalar(consts.maxGroundSpeed)
    let wishspeed = wishvel.length()
    if (wishspeed > 1e-6) {
      wishdir.copy(wishvel).divideScalar(wishspeed)
    } else {
      wishdir.set(0, 0, 0)
      wishspeed = 0
    }
    if (wishspeed > consts.maxGroundSpeed) wishspeed = consts.maxGroundSpeed

    this.categorize(brushes)

    if (this.grounded && input.jump) {
      this.vel.y = consts.jumpImpulse
      this.grounded = false
    }

    if (this.grounded) {
      this.vel.y = 0
      this.friction(dt)
      this.accelerate(wishdir, wishspeed, consts.groundAccelerate, dt)
      this.vel.y = 0
      this.tryPlayerMove(brushes, dt)
    } else {
      // half gravity before and after the move keeps arcs tick rate exact
      this.vel.y -= consts.gravity * dt * 0.5
      const capped = Math.min(wishspeed, consts.airSpeedCap)
      this.accelerate(wishdir, capped, consts.airAccelerate, dt)
      this.tryPlayerMove(brushes, dt)
      this.vel.y -= consts.gravity * dt * 0.5
    }

    const mv = consts.maxVelocity
    this.vel.x = THREE.MathUtils.clamp(this.vel.x, -mv, mv)
    this.vel.y = THREE.MathUtils.clamp(this.vel.y, -mv, mv)
    this.vel.z = THREE.MathUtils.clamp(this.vel.z, -mv, mv)

    this.categorize(brushes)

    if (this.recording) {
      this.diag.horizAfter = Math.hypot(this.vel.x, this.vel.z)
      this.diag.stopReason = this.stopReason
      this.diag.onSurfPlane = this.onSurfPlane
      this.diag.grounded = this.grounded
    }
  }

  // Exact Source acceleration. Airborne callers pass wishspeed already capped
  // at airSpeedCap; the cap applies to both addspeed and accelspeed.
  private accelerate(dir: THREE.Vector3, wishspeed: number, accel: number, dt: number): void {
    const currentspeed = this.vel.x * dir.x + this.vel.y * dir.y + this.vel.z * dir.z
    const addspeed = wishspeed - currentspeed
    if (addspeed <= 0) return
    let accelspeed = accel * wishspeed * dt
    if (accelspeed > addspeed) accelspeed = addspeed
    this.vel.x += accelspeed * dir.x
    this.vel.z += accelspeed * dir.z
  }

  private friction(dt: number): void {
    const speed = this.vel.length()
    if (speed < 0.1) {
      this.vel.set(0, 0, 0)
      return
    }
    const control = Math.max(speed, consts.stopSpeed)
    const drop = control * consts.friction * dt
    const newspeed = Math.max(0, speed - drop)
    this.vel.multiplyScalar(newspeed / speed)
  }

  // Ground check with StayOnGround snap. Steep planes (n.y < 0.7) never count
  // as ground: that is the surf condition, the player stays in air movement.
  private categorize(brushes: Brush[]): void {
    if (this.vel.y > 180) {
      this.grounded = false
      return
    }
    downEnd.copy(this.pos)
    downEnd.y -= 2
    traceHull(this.pos, downEnd, this.half, brushes, tr)
    if (tr.hit && !tr.startSolid && !tr.hitBevel && tr.normal.y >= GROUND_NORMAL_Y) {
      this.grounded = true
      this.pos.copy(tr.endPos)
    } else {
      this.grounded = false
      if (tr.hit && tr.normal.y < GROUND_NORMAL_Y) this.onSurfPlane = true
    }
  }

  // Port of Source TryPlayerMove: up to 4 swept moves per tick, clipping
  // velocity against each contacted plane, sliding along creases, never
  // losing tangential speed at ramp transitions.
  // debug only: records the last hard-stop cause, sticky until the next stop
  private tryPlayerMove(brushes: Brush[], dt: number): void {
    let timeLeft = dt
    let numplanes = 0
    originalVel.copy(this.vel)
    primalVel.copy(this.vel)
    startMovePos.copy(this.pos)
    lastBlocker.set(0, 0, 0)

    for (let bump = 0; bump < 4; bump++) {
      if (this.vel.lengthSq() === 0) break

      moveEnd.copy(this.pos).addScaledVector(this.vel, timeLeft)
      traceHull(this.pos, moveEnd, this.half, brushes, tr)
      if (tr.hit) lastBlocker.copy(tr.blockerNormal)

      if (this.recording) {
        if (tr.startSolid) this.diag.startSolid = true
        if (tr.allSolid) this.diag.allSolid = true
        // record the steep contact the surfer clips against (last one wins);
        // a single-plane stick has exactly one, the offender
        if (tr.hit && tr.normal.y < GROUND_NORMAL_Y) {
          this.diag.contactNormal.copy(tr.normal)
          this.diag.contactBevel = tr.hitBevel
          this.diag.contactSeam = tr.hitSeam
        }
      }

      if (tr.allSolid) {
        this.vel.set(0, 0, 0)
        this.stopReason = 'allsolid'
        return
      }
      if (tr.fraction > 0) {
        this.pos.copy(tr.endPos)
        originalVel.copy(this.vel)
        numplanes = 0
      }
      if (tr.fraction === 1) break

      if (tr.normal.y > 0.05 && tr.normal.y < GROUND_NORMAL_Y) this.onSurfPlane = true

      timeLeft -= timeLeft * tr.fraction

      if (numplanes >= MAX_CLIP_PLANES) {
        this.vel.set(0, 0, 0)
        this.stopReason = 'maxplanes'
        break
      }

      // Quake3 fix: hitting the same plane twice at fraction 0 would build a
      // degenerate crease. Nudge velocity out along the normal and re-trace.
      let duplicate = false
      for (let p = 0; p < numplanes; p++) {
        if (tr.normal.dot(planes[p]) > 0.99) {
          this.vel.add(tr.normal)
          duplicate = true
          break
        }
      }
      if (duplicate) continue

      planes[numplanes].copy(tr.normal)
      numplanes++

      if (this.recording && numplanes > this.diag.planeCount) {
        this.diag.planeCount = numplanes
        for (let p = 0; p < numplanes; p++) this.diag.planes[p].copy(planes[p])
      }

      // find a plane the clipped velocity does not re-enter
      let i = 0
      for (; i < numplanes; i++) {
        clipVelocity(originalVel, planes[i], clipped)
        let j = 0
        for (; j < numplanes; j++) {
          if (j !== i && clipped.dot(planes[j]) < 0) break
        }
        if (j === numplanes) break
      }

      if (i < numplanes) {
        this.vel.copy(clipped)
      } else {
        // no single plane works: slide along the crease of two planes
        if (numplanes !== 2) {
          this.vel.set(0, 0, 0)
          this.stopReason = 'crease' + numplanes
          break
        }
        crease.crossVectors(planes[0], planes[1]).normalize()
        const d = crease.dot(this.vel)
        this.vel.copy(crease).multiplyScalar(d)
      }

      // stop dead if we ever turn against our original direction
      if (this.vel.dot(primalVel) <= 0) {
        this.vel.set(0, 0, 0)
        this.stopReason = 'primal'
        break
      }
    }

    // Wedge guard. If the whole tick made essentially no progress while the hull
    // still carries real speed, it is jammed: the swept move is fraction-0 bounded
    // by a plane the rampbug redirect hid (a bevel or seam the hull is pressed
    // against), so clipVelocity kept removing the wrong component and gravity plus
    // air-accel pumped the velocity unbounded while the position froze. That is the
    // apex/edge freeze a human hits riding up to the very top of a ramp: the speed
    // readout climbs past anything while the player does not move. Clip the
    // velocity against the real blocking plane so the hull sheds the into-blocker
    // component and slides off next tick instead of accelerating in place.
    if (
      this.vel.lengthSq() > 10000 &&
      this.pos.distanceToSquared(startMovePos) < 1 &&
      lastBlocker.lengthSq() > 0.5
    ) {
      clipVelocity(this.vel, lastBlocker, clipped)
      this.vel.copy(clipped)
      this.stopReason = 'wedged'
    }
  }
}
