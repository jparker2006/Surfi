// Fixed timestep accumulator. Physics steps at a constant tick rate no matter
// the display refresh; the render callback receives the interpolation alpha.

export class FixedLoop {
  alpha = 0
  tickCount = 0
  fps = 0

  private acc = 0
  private last = -1
  private frames = 0
  private fpsWindowStart = 0
  private running = false

  private readonly tickDt: number
  private readonly tickFn: () => void
  private readonly renderFn: (alpha: number) => void

  constructor(tickDt: number, tickFn: () => void, renderFn: (alpha: number) => void) {
    this.tickDt = tickDt
    this.tickFn = tickFn
    this.renderFn = renderFn
  }

  start(): void {
    if (this.running) return
    this.running = true
    requestAnimationFrame(this.frame)
  }

  private frame = (t: number): void => {
    if (this.last < 0) {
      this.last = t
      this.fpsWindowStart = t
    }
    let dt = (t - this.last) / 1000
    if (dt > 0.25) dt = 0.25 // tab switch or hitch: do not spiral
    this.last = t

    this.acc += dt
    while (this.acc >= this.tickDt) {
      this.tickFn()
      this.acc -= this.tickDt
      this.tickCount++
    }
    this.alpha = this.acc / this.tickDt
    this.renderFn(this.alpha)

    this.frames++
    if (t - this.fpsWindowStart >= 500) {
      this.fps = Math.round((this.frames * 1000) / (t - this.fpsWindowStart))
      this.frames = 0
      this.fpsWindowStart = t
    }

    requestAnimationFrame(this.frame)
  }
}
