import type { Consts } from '../engine/physics/constants'

// A level is a plain config module. Engine code is level-agnostic; adding a
// new level means writing one new file shaped like this and nothing else.

// Difficulty curve parameter evaluated at course distance d:
// value = clamp(base + rate * d, min, max)
export interface DifficultyParam {
  base: number
  rate: number
  min: number
  max: number
}

export function evalParam(p: DifficultyParam, d: number): number {
  return Math.min(p.max, Math.max(p.min, p.base + p.rate * d))
}

export interface GenerationConfig {
  // 'random' picks a new seed each run; ?test=1 always forces fixedSeed
  seedRule: 'random' | 'fixed'
  fixedSeed: number
  weights: { straight: number; curve: number; gap: number; spine: number }
  rampHalfWidth: DifficultyParam
  rampHeight: DifficultyParam
  segmentLength: DifficultyParam
  gapSize: DifficultyParam
  curveAngleDeg: DifficultyParam
  // ridge drop per unit traveled forward
  descentSlope: DifficultyParam
  // the first segment is always a wide straight opener of this length
  openerLength: number
  // no gap segments before this course distance
  gapMinDistance: number
}

export interface AestheticConfig {
  baseHue: number
  // hue rotations per minute at rest, plus extra at full speed intensity
  hueCycleSpeed: number
  hueSpeedBoost: number
  fogColor: number
  fogDensity: number
  bloom: { base: number; max: number }
  chromatic: { base: number; max: number }
  vignette: number
  // horizontal fov degrees added at full speed intensity
  fovKick: number
  // horizontal speed in u/s that maps to fx intensity 1.0
  speedForMaxFx: number
  particles: { count: number; baseSize: number }
  pulseAmount: number
}

export interface AudioConfig {
  baseFreq: number
  detuneCents: number
  filterBase: number
  filterMax: number
}

export interface LevelConfig {
  id: string
  title: string
  generation: GenerationConfig
  aesthetic: AestheticConfig
  audio: AudioConfig
  physics?: Partial<Consts>
}
