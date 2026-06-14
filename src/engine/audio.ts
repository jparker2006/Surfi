import type { AudioConfig } from '../levels/types'
import type { SettingsStore } from './settings'

// Speed-reactive synth drone: two detuned saws and a sub sine through a low
// pass filter. Speed intensity opens the filter; the settings master volume
// swells the gain. Starts only after a user gesture. Volume lives in settings
// (replacing the old mute toggle) and applies live.

// gain at full volume; the unmuted level the old mute toggle used
const MAX_GAIN = 0.055

export class Drone {
  private ctx: AudioContext | null = null
  private filter: BiquadFilterNode | null = null
  private gain: GainNode | null = null
  private readonly cfg: AudioConfig
  private volume: number

  constructor(cfg: AudioConfig, settings: SettingsStore) {
    this.cfg = cfg
    this.volume = settings.get().volume
    settings.subscribe((s) => {
      if (s.volume !== this.volume) {
        this.volume = s.volume
        this.applyVolume()
      }
    })
  }

  // perceptual map 0..100 -> 0..MAX_GAIN (square curve so the low end is usable)
  get targetGain(): number {
    const v = this.volume / 100
    return MAX_GAIN * v * v
  }

  // call from a user gesture handler
  ensureStarted(): void {
    if (this.ctx) return
    const ctx = new AudioContext()
    this.ctx = ctx

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = this.cfg.filterBase
    filter.Q.value = 6

    const gain = ctx.createGain()
    gain.gain.value = 0

    const mk = (type: OscillatorType, freq: number, detune: number): OscillatorNode => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      o.detune.value = detune
      o.connect(filter)
      o.start()
      return o
    }
    mk('sawtooth', this.cfg.baseFreq, 0)
    mk('sawtooth', this.cfg.baseFreq, this.cfg.detuneCents)
    mk('sine', this.cfg.baseFreq / 2, 0)

    // slow stereo-ish movement from an lfo on the filter
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 40
    lfo.connect(lfoGain)
    lfoGain.connect(filter.frequency)
    lfo.start()

    filter.connect(gain)
    gain.connect(ctx.destination)
    this.filter = filter
    this.gain = gain
    this.applyVolume()
  }

  update(intensity: number): void {
    if (!this.ctx || !this.filter) return
    const c = this.cfg
    const f = c.filterBase + (c.filterMax - c.filterBase) * Math.pow(intensity, 1.5)
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08)
  }

  private applyVolume(): void {
    if (!this.ctx || !this.gain) return
    this.gain.gain.setTargetAtTime(this.targetGain, this.ctx.currentTime, 0.25)
  }
}
