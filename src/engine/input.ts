import { consts } from './physics/constants'
import type { InputFrame } from './physics/controller'

const DEG2RAD = Math.PI / 180
const PITCH_LIMIT = 89 * DEG2RAD

export interface InjectedInput {
  forward?: boolean
  back?: boolean
  left?: boolean
  right?: boolean
  jump?: boolean
  yaw?: number
  pitch?: number
}

// Keyboard + pointer lock mouse. In test mode (?test=1) pointer lock is not
// required and window.__surfInput can inject deterministic input frames.

export class InputSystem {
  yaw = 0
  pitch = 0
  pointerLocked = false
  onRespawn: (() => void) | null = null
  onToggleDebug: (() => void) | null = null
  onToggleMute: (() => void) | null = null

  private readonly keys = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
  }

  private injectionActive = false
  private readonly injected: Required<InjectedInput> = {
    forward: false, back: false, left: false, right: false, jump: false, yaw: 0, pitch: 0,
  }

  private readonly frameOut: InputFrame = {
    forward: false, back: false, left: false, right: false, jump: false, yaw: 0, pitch: 0,
  }

  private readonly testMode: boolean

  constructor(testMode: boolean) {
    this.testMode = testMode
  }

  attach(el: HTMLElement): void {
    window.addEventListener('keydown', (e) => this.onKey(e, true))
    window.addEventListener('keyup', (e) => this.onKey(e, false))

    el.addEventListener('click', () => {
      if (!this.testMode && document.pointerLockElement !== el) {
        // returns a promise in modern browsers; rejection (iframes, synthetic
        // clicks) must not surface as an unhandled error
        const r = el.requestPointerLock() as unknown
        if (r instanceof Promise) r.catch(() => {})
      }
    })
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === el
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.injectionActive) return
      this.yaw -= e.movementX * consts.sensitivity * DEG2RAD
      this.pitch -= e.movementY * consts.sensitivity * DEG2RAD
      if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT
      if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT
    })
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    switch (e.code) {
      case 'KeyW': this.keys.forward = down; break
      case 'KeyS': this.keys.back = down; break
      case 'KeyA': this.keys.left = down; break
      case 'KeyD': this.keys.right = down; break
      case 'Space': this.keys.jump = down; e.preventDefault(); break
      case 'KeyR':
        if (down) this.onRespawn?.()
        break
      case 'KeyM':
        if (down) this.onToggleMute?.()
        break
      case 'Backquote':
      case 'F3':
        if (down) {
          e.preventDefault()
          this.onToggleDebug?.()
        }
        break
    }
  }

  inject(p: InjectedInput): void {
    this.injectionActive = true
    Object.assign(this.injected, p)
  }

  clearInjection(): void {
    this.injectionActive = false
  }

  // Snapshot of input as seen by the next physics tick.
  frame(): InputFrame {
    const out = this.frameOut
    if (this.injectionActive) {
      out.forward = this.injected.forward
      out.back = this.injected.back
      out.left = this.injected.left
      out.right = this.injected.right
      out.jump = this.injected.jump
      out.yaw = this.injected.yaw
      out.pitch = this.injected.pitch
      // keep the render view in sync with injected aim
      this.yaw = this.injected.yaw
      this.pitch = this.injected.pitch
    } else {
      out.forward = this.keys.forward
      out.back = this.keys.back
      out.left = this.keys.left
      out.right = this.keys.right
      out.jump = this.keys.jump
      out.yaw = this.yaw
      out.pitch = this.pitch
    }
    return out
  }
}
