import type { LevelConfig } from './types'

// acidsurf: the one shipped level. An endless psychedelic descent. Difficulty
// scales with distance: narrower ramps, wider gaps, sharper curves.

export const acidsurf: LevelConfig = {
  id: 'acidsurf',
  title: 'acidsurf',

  generation: {
    seedRule: 'random',
    fixedSeed: 1337,
    weights: { straight: 0.38, curve: 0.34, gap: 0.16, spine: 0.12 },
    rampHalfWidth: { base: 420, rate: -0.004, min: 240, max: 420 },
    rampHeight: { base: 560, rate: -0.005, min: 330, max: 560 },
    segmentLength: { base: 1500, rate: 0, min: 1500, max: 1500 },
    gapSize: { base: 240, rate: 0.012, min: 240, max: 720 },
    curveAngleDeg: { base: 22, rate: 0.0022, min: 22, max: 75 },
    descentSlope: { base: 0.12, rate: 0, min: 0.12, max: 0.12 },
    openerLength: 3400,
    gapMinDistance: 5000,
  },

  aesthetic: {
    baseHue: 0.78,
    hueCycleSpeed: 1.6,
    hueSpeedBoost: 9,
    fogColor: 0x0b0414,
    fogDensity: 0.00022,
    bloom: { base: 0.35, max: 0.9 },
    chromatic: { base: 0.0012, max: 0.018 },
    vignette: 0.85,
    fovKick: 15,
    speedForMaxFx: 1900,
    particles: { count: 900, baseSize: 7 },
    pulseAmount: 0.5,
  },

  audio: {
    baseFreq: 55,
    detuneCents: 9,
    filterBase: 220,
    filterMax: 2600,
  },

  // acidsurf overrides nothing: pure Source surf constants
}
