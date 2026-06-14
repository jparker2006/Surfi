import * as THREE from 'three'

// Dev/test-only per-frame diagnostics. Reads back a few framebuffer strips at
// the end of each rendered frame to measure full-frame luminance (flash
// detection) and, on request, samples a horizontal scanline across the ramp
// (line detection). Zero cost unless a recording or a scanline is pending.
//
// readPixels must run inside the render callback: the default framebuffer is
// only valid before the browser composites, and the renderer is created
// without preserveDrawingBuffer. Driven from the test API (window.__surfFx).

export interface FxFrame {
  t: number
  lum: number
  intensity: number
  speed: number
  state: string
  // cumulative course spawn/despawn events and run (respawn) count, so a
  // luminance spike can be correlated with the event that caused it
  gen: number
  runs: number
}

export interface FxMeta {
  intensity: number
  speed: number
  state: string
  gen: number
  runs: number
}

export class FxProbe {
  enabled = false
  frames: FxFrame[] = []
  // per sample: luminance plus raw rgb (0..1), so a face mask can be built from
  // chroma (the flat control renders the ramp pure gray)
  scanResult: Array<{ l: number; r: number; g: number; b: number }> | null = null

  private readonly renderer: THREE.WebGLRenderer
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext
  private buf = new Uint8Array(0)
  private scanReq: { fy: number; n: number } | null = null

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.gl = renderer.getContext()
  }

  start(): void {
    this.frames = []
    this.enabled = true
  }

  stop(): FxFrame[] {
    this.enabled = false
    return this.frames
  }

  // request a single horizontal scanline next frame: fy is the vertical
  // fraction from the TOP of the frame, n evenly spaced samples across the
  // full width, each returned as luminance 0..1
  requestScanline(fy: number, n: number): void {
    this.scanResult = null
    this.scanReq = { fy, n }
  }

  // called at the very end of render(), final image still in the back buffer
  frame(meta: FxMeta): void {
    if (!this.enabled && !this.scanReq) return
    const gl = this.gl
    const cw = this.renderer.domElement.width
    const ch = this.renderer.domElement.height
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    if (this.enabled) {
      const stripH = 2
      const rows = [0.25, 0.5, 0.75]
      const need = cw * stripH * 4
      if (this.buf.length < need) this.buf = new Uint8Array(need)
      let sum = 0
      let cnt = 0
      for (const fr of rows) {
        const y = Math.max(0, Math.min(ch - stripH, Math.floor(ch * fr)))
        gl.readPixels(0, y, cw, stripH, gl.RGBA, gl.UNSIGNED_BYTE, this.buf)
        for (let i = 0; i < cw * stripH; i++) {
          const r = this.buf[i * 4]
          const g = this.buf[i * 4 + 1]
          const b = this.buf[i * 4 + 2]
          sum += (0.299 * r + 0.587 * g + 0.114 * b) / 255
          cnt++
        }
      }
      this.frames.push({ t: performance.now(), lum: sum / cnt, ...meta })
      if (this.frames.length > 6000) this.frames.shift()
    }

    if (this.scanReq) {
      const { fy, n } = this.scanReq
      // readPixels origin is bottom-left; fy is from the top
      const y = Math.max(0, Math.min(ch - 1, Math.floor(ch * (1 - fy))))
      const row = new Uint8Array(cw * 4)
      gl.readPixels(0, y, cw, 1, gl.RGBA, gl.UNSIGNED_BYTE, row)
      const res: Array<{ l: number; r: number; g: number; b: number }> = []
      for (let i = 0; i < n; i++) {
        const x = Math.floor((i / Math.max(1, n - 1)) * (cw - 1))
        const r = row[x * 4] / 255
        const g = row[x * 4 + 1] / 255
        const b = row[x * 4 + 2] / 255
        res.push({ l: 0.299 * r + 0.587 * g + 0.114 * b, r, g, b })
      }
      this.scanResult = res
      this.scanReq = null
    }
  }
}
