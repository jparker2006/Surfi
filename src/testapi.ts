import type { PlayerController } from './engine/physics/controller'
import type { InputSystem, InjectedInput } from './engine/input'
import type { Game } from './engine/game'
import type { CourseGenerator } from './engine/gen/generator'

// Test instrumentation, installed in dev builds and whenever ?test=1 is set.
// Playwright cannot drive pointer lock, so __surfInput injects deterministic
// input frames and __surf exposes the live physics state.

export interface SurfDebug {
  speed: number
  pos: { x: number; y: number; z: number }
  vel: { x: number; y: number; z: number }
  airborne: boolean
  onSurfPlane: boolean
  stopReason: string
  distance: number
  tick: number
  state: string
  best: number
  // teleport resets the run (fixed seed in test mode, so the course is
  // identical) and places the player; always lands in a live run
  teleport: (x: number, y: number, z: number) => void
  setVelocity: (x: number, y: number, z: number) => void
  respawn: () => void
  // Step the simulation synchronously, bypassing the render loop. Used for
  // tick rate independence checks: results must not depend on batching.
  stepTicks: (n: number) => void
  // spine point at course distance, for scripted survival bots
  spineAt: (cum: number) => { x: number; y: number; z: number; heading: number } | null
}

declare global {
  interface Window {
    __surf?: SurfDebug
    __surfInput?: {
      set: (p: InjectedInput) => void
      clear: () => void
    }
  }
}

export function isTestMode(): boolean {
  return new URLSearchParams(location.search).get('test') === '1'
}

export function installTestApi(
  controller: PlayerController,
  input: InputSystem,
  game: Game,
  gen: CourseGenerator,
  stepOneTick: () => void,
): SurfDebug {
  const surf: SurfDebug = {
    speed: 0,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    airborne: true,
    onSurfPlane: false,
    stopReason: '',
    distance: 0,
    tick: 0,
    state: 'start',
    best: 0,
    teleport(x, y, z) {
      game.startRun()
      controller.pos.set(x, y, z)
      controller.vel.set(0, 0, 0)
    },
    setVelocity(x, y, z) {
      controller.vel.set(x, y, z)
    },
    respawn() {
      game.startRun()
    },
    stepTicks(n) {
      for (let i = 0; i < n; i++) stepOneTick()
    },
    spineAt(cum) {
      return gen.spineAt(cum)
    },
  }
  window.__surf = surf
  window.__surfInput = {
    set: (p) => input.inject(p),
    clear: () => input.clearInjection(),
  }
  return surf
}

export function updateTestApi(surf: SurfDebug, controller: PlayerController, game: Game, tick: number): void {
  surf.speed = Math.hypot(controller.vel.x, controller.vel.z)
  surf.pos.x = controller.pos.x
  surf.pos.y = controller.pos.y
  surf.pos.z = controller.pos.z
  surf.vel.x = controller.vel.x
  surf.vel.y = controller.vel.y
  surf.vel.z = controller.vel.z
  surf.airborne = !controller.grounded
  surf.onSurfPlane = controller.onSurfPlane
  surf.stopReason = controller.stopReason
  surf.distance = game.distance
  surf.state = game.state
  surf.best = game.best
  surf.tick = tick
}
