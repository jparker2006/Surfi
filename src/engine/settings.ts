import { consts } from './physics/constants'

// Player settings store: persisted to localStorage, observable, clamped on load.
// The single source of truth for volume, look sensitivity, and the reduce
// intensity (photosensitivity / motion comfort) toggle. Read on load and on
// change by the drone, input, and the fx wiring, so a slider takes effect live.

export interface Settings {
  // master drone volume, 0..100 (replaces the old mute toggle)
  volume: number
  // mouse look, degrees of rotation per mouse count (CS feel)
  sensitivity: number
  // one comfort toggle: scales the psychedelic fx and the landing animations
  reduceIntensity: boolean
}

const KEY = 'surfi:settings'
const LEGACY_MUTE = 'surfi:muted'

// fx intensity multiplier when reduceIntensity is on
const FX_REDUCED = 0.45

export const SETTINGS_RANGES = {
  volume: { min: 0, max: 100, step: 1 },
  // 0.005 (slow) .. 0.08 (fast); default tracks the frozen consts.sensitivity
  sensitivity: { min: 0.005, max: 0.08, step: 0.001 },
} as const

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

function defaults(): Settings {
  // seed reduce intensity from the OS preference; seed volume from the legacy
  // mute key so a returning muted player stays muted
  const prefersReduced =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  const wasMuted = localStorage.getItem(LEGACY_MUTE) === '1'
  return {
    volume: wasMuted ? 0 : 70,
    sensitivity: consts.sensitivity,
    reduceIntensity: prefersReduced,
  }
}

export class SettingsStore {
  private value: Settings
  private readonly subs = new Set<(s: Readonly<Settings>) => void>()

  constructor() {
    this.value = this.load()
  }

  private load(): Settings {
    const base = defaults()
    let stored: Partial<Settings> | null = null
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) stored = JSON.parse(raw) as Partial<Settings>
    } catch {
      stored = null
    }
    if (!stored) return base
    return {
      volume: clamp(
        typeof stored.volume === 'number' ? stored.volume : base.volume,
        SETTINGS_RANGES.volume.min,
        SETTINGS_RANGES.volume.max,
      ),
      sensitivity: clamp(
        typeof stored.sensitivity === 'number' ? stored.sensitivity : base.sensitivity,
        SETTINGS_RANGES.sensitivity.min,
        SETTINGS_RANGES.sensitivity.max,
      ),
      reduceIntensity:
        typeof stored.reduceIntensity === 'boolean' ? stored.reduceIntensity : base.reduceIntensity,
    }
  }

  get(): Readonly<Settings> {
    return this.value
  }

  set(patch: Partial<Settings>): void {
    const next: Settings = { ...this.value }
    if (typeof patch.volume === 'number') {
      next.volume = clamp(patch.volume, SETTINGS_RANGES.volume.min, SETTINGS_RANGES.volume.max)
    }
    if (typeof patch.sensitivity === 'number') {
      next.sensitivity = clamp(
        patch.sensitivity,
        SETTINGS_RANGES.sensitivity.min,
        SETTINGS_RANGES.sensitivity.max,
      )
    }
    if (typeof patch.reduceIntensity === 'boolean') {
      next.reduceIntensity = patch.reduceIntensity
    }
    this.value = next
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // storage full or unavailable: keep the in-memory value
    }
    for (const fn of this.subs) fn(this.value)
  }

  // returns an unsubscribe function
  subscribe(fn: (s: Readonly<Settings>) => void): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  // visual intensity multiplier applied to the speed-reactive fx
  get fxScale(): number {
    return this.value.reduceIntensity ? FX_REDUCED : 1
  }

  // whether to tone down the landing animations
  get reduceMotion(): boolean {
    return this.value.reduceIntensity
  }
}
