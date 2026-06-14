import * as THREE from 'three'
import type { PaletteDriver } from './fx/palette'

// DOM overlay HUD. Two live elements during play: speedometer (bottom center,
// the primary physics debugging instrument) and distance (top center). Plus
// the death / wipeout screen. Accent glow colors are driven from the live
// palette so the HUD breathes with the world; the NUMBERS themselves stay a
// fixed high-contrast fill so they are always instantly readable.

export interface DeathStats {
  distance: number
  peakSpeed: number
  best: number
  isNewBest: boolean
}

export class Hud {
  // wipeout "menu" button -> exit to the landing
  onMenu: (() => void) | null = null

  private readonly speedEl: HTMLDivElement
  private readonly distanceEl: HTMLDivElement
  private readonly overlayEl: HTMLDivElement
  private lastSpeed = -1
  private lastDistance = -1

  // palette accent bridge
  private readonly accent = new THREE.Color()
  private readonly accentDist = new THREE.Color()
  private readonly accentWipe = new THREE.Color()
  private lastAccentKey = ''

  constructor(root: HTMLElement) {
    this.speedEl = document.createElement('div')
    this.speedEl.className = 'hud-speed'
    this.speedEl.textContent = '0'
    root.appendChild(this.speedEl)

    this.distanceEl = document.createElement('div')
    this.distanceEl.className = 'hud-distance'
    this.distanceEl.textContent = '0'
    root.appendChild(this.distanceEl)

    this.overlayEl = document.createElement('div')
    this.overlayEl.className = 'hud-overlay'
    root.appendChild(this.overlayEl)

    // the wipeout "menu" button lives inside the overlay but is clickable even
    // though the overlay passes pointer events through; delegate its click
    this.overlayEl.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t && t.classList.contains('death-menu')) {
        e.stopPropagation()
        this.onMenu?.()
      }
    })
  }

  setSpeed(speed: number): void {
    const s = Math.round(speed)
    if (s !== this.lastSpeed) {
      this.lastSpeed = s
      this.speedEl.textContent = String(s)
    }
  }

  setDistance(distance: number): void {
    const d = Math.round(distance)
    if (d !== this.lastDistance) {
      this.lastDistance = d
      this.distanceEl.textContent = String(d)
    }
  }

  setHudVisible(on: boolean): void {
    const v = on ? 'block' : 'none'
    this.speedEl.style.display = v
    this.distanceEl.style.display = v
  }

  // push the live palette accent + speed intensity into CSS custom properties.
  // Quantized so we only touch the DOM when the color bucket or intensity step
  // actually changes (no per-frame string churn). Numbers keep their fixed fill;
  // only the glow color/strength tracks the palette.
  update(palette: PaletteDriver, intensity: number): void {
    palette.sampleAccent(this.accent, 0)
    palette.sampleAccent(this.accentDist, 0.18)
    palette.sampleAccent(this.accentWipe, 0.4)
    const ib = Math.round(THREE.MathUtils.clamp(intensity, 0, 1) * 20) / 20
    const key = this.accent.getHexString() + this.accentDist.getHexString() + this.accentWipe.getHexString() + ib
    if (key === this.lastAccentKey) return
    this.lastAccentKey = key
    const root = document.documentElement.style
    root.setProperty('--hud-accent', rgb(this.accent))
    root.setProperty('--hud-accent-distance', rgb(this.accentDist))
    root.setProperty('--hud-accent-wipe', rgb(this.accentWipe))
    root.setProperty('--hud-intensity', String(ib))
  }

  // pointer unlocked mid-run: prompt to click back in (no level select here)
  showResume(): void {
    this.overlayEl.innerHTML = `<p class="cta">click to resume</p>`
    this.overlayEl.style.display = 'flex'
  }

  showDeath(stats: DeathStats): void {
    this.overlayEl.innerHTML = `
      <h1 class="death-title">wipeout</h1>
      <div class="stats">
        <p><span class="stat-label">distance</span><span class="stat-value">${Math.floor(stats.distance)}</span></p>
        <p><span class="stat-label">peak speed</span><span class="stat-value">${Math.floor(stats.peakSpeed)}</span></p>
        <p><span class="stat-label">best</span><span class="stat-value">${Math.floor(stats.best)}${stats.isNewBest ? ' &#9733; new' : ''}</span></p>
      </div>
      <p class="cta">press any key to drop back in</p>
      <button class="death-menu" type="button">menu</button>`
    this.overlayEl.style.display = 'flex'
  }

  hideOverlay(): void {
    this.overlayEl.style.display = 'none'
  }
}

// vivid rgb() string from a 0..1 color, clamped (raw palette color, no tone map)
function rgb(c: THREE.Color): string {
  const r = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255)
  const g = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255)
  const b = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255)
  return `rgb(${r}, ${g}, ${b})`
}
