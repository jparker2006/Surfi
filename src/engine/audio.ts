import type { AudioConfig } from '../levels/types'

// Speed-reactive synth drone: two detuned saws and a sub sine through a low
// pass filter. Speed intensity opens the filter and swells the volume.
// Starts only after a user gesture; mute state persists in localStorage.

const MUTE_KEY = 'surfi:muted'

export class Drone {
  muted: boolean
  private ctx: AudioContext | null = null
  private filter: BiquadFilterNode | null = null
  private gain: GainNode | null = null
  private readonly cfg: AudioConfig

  constructor(cfg: AudioConfig) {
    this.cfg = cfg
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
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
    this.applyMute()
  }

  update(intensity: number): void {
    if (!this.ctx || !this.filter) return
    const c = this.cfg
    const f = c.filterBase + (c.filterMax - c.filterBase) * Math.pow(intensity, 1.5)
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08)
  }

  toggleMute(): void {
    this.muted = !this.muted
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    this.applyMute()
  }

  private applyMute(): void {
    if (!this.ctx || !this.gain) return
    const target = this.muted ? 0 : 0.055
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25)
  }
}
