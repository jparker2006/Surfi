// DOM overlay HUD. Two live elements: speedometer (bottom center, the primary
// physics debugging instrument) and distance (top center).

export class Hud {
  private readonly speedEl: HTMLDivElement
  private readonly distanceEl: HTMLDivElement
  private readonly overlayEl: HTMLDivElement
  private lastSpeed = -1
  private lastDistance = -1

  constructor(root: HTMLElement) {
    this.speedEl = document.createElement('div')
    this.speedEl.className = 'hud-speed'
    this.speedEl.textContent = '0'
    root.appendChild(this.speedEl)

    this.distanceEl = document.createElement('div')
    this.distanceEl.className = 'hud-distance'
    this.distanceEl.textContent = ''
    root.appendChild(this.distanceEl)

    this.overlayEl = document.createElement('div')
    this.overlayEl.className = 'hud-overlay'
    root.appendChild(this.overlayEl)
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

  showOverlay(html: string): void {
    this.overlayEl.innerHTML = html
    this.overlayEl.style.display = 'flex'
  }

  hideOverlay(): void {
    this.overlayEl.style.display = 'none'
  }
}
