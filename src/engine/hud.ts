// DOM overlay HUD. Two live elements during play: speedometer (bottom center,
// the primary physics debugging instrument) and distance (top center). Plus
// the start screen and the death screen.

export interface DeathStats {
  distance: number
  peakSpeed: number
  best: number
  isNewBest: boolean
}

export class Hud {
  onMuteToggle: (() => void) | null = null

  private readonly speedEl: HTMLDivElement
  private readonly distanceEl: HTMLDivElement
  private readonly overlayEl: HTMLDivElement
  private readonly muteEl: HTMLButtonElement
  private lastSpeed = -1
  private lastDistance = -1

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

    this.muteEl = document.createElement('button')
    this.muteEl.className = 'hud-mute'
    this.muteEl.type = 'button'
    this.muteEl.addEventListener('click', () => this.onMuteToggle?.())
    root.appendChild(this.muteEl)
  }

  setMuted(muted: boolean): void {
    this.muteEl.textContent = muted ? 'sound off [m]' : 'sound on [m]'
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

  showStart(title: string, levelName: string, resume: boolean): void {
    this.overlayEl.innerHTML = `
      <h1 class="title">${title}</h1>
      <p class="level-name">${levelName}</p>
      <p class="cta">${resume ? 'click to resume' : 'click to surf'}</p>
      <div class="hint">
        <p>WASD plus mouse: surf. Strafe into the ramp face to gain speed.</p>
        <p>Space: jump. R: respawn.</p>
        <p>Backtick or F3: debug panel.</p>
      </div>`
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
      <p class="cta">press any key to drop back in</p>`
    this.overlayEl.style.display = 'flex'
  }

  hideOverlay(): void {
    this.overlayEl.style.display = 'none'
  }
}
