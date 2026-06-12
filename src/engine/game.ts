import type { PlayerController } from './physics/controller'
import type { CourseGenerator } from './gen/generator'
import type { LevelConfig } from '../levels/types'
import * as THREE from 'three'

// Run state machine: start screen, playing, dead. Respawn is a pure state
// reset so the restart loop stays well under one second.

export type GameState = 'start' | 'playing' | 'dead'

export class Game {
  state: GameState = 'start'
  distance = 0
  peakSpeed = 0
  best = 0
  newBest = false
  runSeed = 0

  private spineIndex = 0
  private readonly level: LevelConfig
  private readonly controller: PlayerController
  private readonly gen: CourseGenerator
  private readonly spawn: THREE.Vector3
  private readonly testMode: boolean
  private readonly bestKey: string

  constructor(
    level: LevelConfig,
    controller: PlayerController,
    gen: CourseGenerator,
    spawn: THREE.Vector3,
    testMode: boolean,
  ) {
    this.level = level
    this.controller = controller
    this.gen = gen
    this.spawn = spawn.clone()
    this.testMode = testMode
    this.bestKey = `surfi:best:${level.id}`
    this.best = Number(localStorage.getItem(this.bestKey) ?? 0)
  }

  private pickSeed(): number {
    if (this.testMode) {
      const q = new URLSearchParams(location.search).get('seed')
      return q ? Number(q) >>> 0 : this.level.generation.fixedSeed
    }
    if (this.level.generation.seedRule === 'fixed') {
      return this.level.generation.fixedSeed
    }
    return (Math.random() * 0x7fffffff) >>> 0
  }

  // reset everything for a fresh run; this is both "play" and "respawn"
  startRun(): void {
    this.recordBest()
    this.runSeed = this.pickSeed()
    this.gen.reset(this.runSeed)
    this.controller.pos.copy(this.spawn)
    this.controller.vel.set(0, 0, 0)
    this.distance = 0
    this.peakSpeed = 0
    this.spineIndex = 0
    this.newBest = false
    this.state = 'playing'
  }

  // called once per physics tick while playing, after the controller moved
  onTick(): void {
    if (this.state !== 'playing') return

    const speed = Math.hypot(this.controller.vel.x, this.controller.vel.z)
    if (speed > this.peakSpeed) this.peakSpeed = speed

    const res = this.gen.progress(this.controller.pos, this.spineIndex)
    this.spineIndex = res.index
    // the odometer is the peak arc length reached this run: it only ever grows.
    // If the player slides back down the course the projected distance drops,
    // but the score holds, so backward motion never counts down on screen.
    if (res.dist > this.distance) this.distance = res.dist
    this.gen.ensure(res.dist)

    if (this.controller.pos.y < res.killY) this.die()
  }

  die(): void {
    if (this.state !== 'playing') return
    this.newBest = this.recordBest()
    this.state = 'dead'
  }

  // used by the test api: teleports must always land in a live run
  forcePlaying(): void {
    if (this.state !== 'playing') {
      if (this.state === 'dead') this.recordBest()
      this.state = 'playing'
    }
  }

  private recordBest(): boolean {
    if (Math.floor(this.distance) > this.best) {
      this.best = Math.floor(this.distance)
      localStorage.setItem(this.bestKey, String(this.best))
      return true
    }
    return false
  }
}
