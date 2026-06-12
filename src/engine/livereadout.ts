import * as THREE from 'three'
import { consts } from './physics/constants'
import { traceHull, createTraceResult } from './physics/trace'
import type { PlayerController } from './physics/controller'
import type { CourseGenerator } from './gen/generator'

// Live contact readout (debug only). A compact always-on panel that updates
// every frame while playing, so a human can read off exactly what the engine
// thinks is happening at the instant they stick: grounded vs airborne, the
// classification and normal of the surface under the hull, the clip contact
// normal, horizontal and along-course speed, the current segment, and how high
// up the ridge they are. It pokes nothing in the sim: a short read-only down
// trace plus course queries, no physics mutation.

// mirrors GROUND_NORMAL_Y in controller.ts: at or above this a face is walkable
const GROUND_CUTOFF = 0.7
const SURF_MIN_Y = 0.05

export class LiveReadout {
  private readonly el: HTMLDivElement
  private shown = false
  private readonly half = new THREE.Vector3()
  private readonly down = new THREE.Vector3()
  private readonly tr = createTraceResult()
  private readonly buildLabel: string

  constructor(root: HTMLElement, buildLabel: string) {
    this.buildLabel = buildLabel
    this.el = document.createElement('div')
    this.el.className = 'live-readout'
    this.el.style.display = 'none'
    root.appendChild(this.el)
  }

  toggle(on: boolean): void {
    this.shown = on
    this.el.style.display = on ? 'block' : 'none'
  }

  get visible(): boolean {
    return this.shown
  }

  update(controller: PlayerController, gen: CourseGenerator, liveDistance: number): void {
    if (!this.shown) return

    // surface directly under the hull: a short read-only downward hull trace
    this.half.set(consts.hullWidth / 2, consts.hullHeight / 2, consts.hullWidth / 2)
    this.down.copy(controller.pos)
    this.down.y -= 64
    traceHull(controller.pos, this.down, this.half, gen.collision, this.tr)
    let under = 'air'
    let underNy = 0
    let underGap = Infinity
    if (this.tr.hit) {
      underNy = this.tr.normal.y
      underGap = controller.pos.y - this.tr.endPos.y
      if (this.tr.hitBevel) under = 'bevel'
      else if (this.tr.hitSeam) under = 'seam'
      else if (underNy >= GROUND_CUTOFF) under = 'GROUND'
      else if (underNy >= SURF_MIN_Y) under = 'surf'
      else under = 'under-face'
    }

    const seg = gen.segmentAt(liveDistance)
    const apex = gen.spineAt(liveDistance)
    const belowApex = apex ? apex.y - controller.pos.y : 0
    const heading = apex ? apex.heading : 0
    const horiz = Math.hypot(controller.vel.x, controller.vel.z)
    // course forward from heading: (-sin, -cos); along speed is velocity onto it
    const along = controller.vel.x * -Math.sin(heading) + controller.vel.z * -Math.cos(heading)
    const cn = controller.diag.contactNormal
    const hasClip = cn.x * cn.x + cn.y * cn.y + cn.z * cn.z > 0.25

    const f1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1)
    this.el.textContent =
      `build   ${this.buildLabel}\n` +
      `state   ${controller.grounded ? 'GROUNDED' : 'airborne'}\n` +
      `under   ${under}  n.y ${f1(underNy)}  gap ${underGap === Infinity ? '-' : f1(underGap)}u\n` +
      `clip    ${hasClip ? 'n.y ' + f1(cn.y) : '(none)'}\n` +
      `speed   ${Math.round(horiz)}  along ${Math.round(along)}\n` +
      `segment ${seg ? seg.kind + ' #' + seg.id : '-'}\n` +
      `belowApex ${Math.round(belowApex)}u   dist ${Math.round(liveDistance)}\n` +
      `[K] capture last ${180} ticks`
  }
}
