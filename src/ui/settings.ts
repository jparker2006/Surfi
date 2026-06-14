import gsap from 'gsap'
import { SettingsStore, SETTINGS_RANGES } from '../engine/settings'

// Settings panel: volume, look sensitivity, reduce intensity. Reads the store,
// writes live on every input event (so a slider is audible/visible immediately),
// and persists through the store. Shown from the landing and the wipeout screen.

export class SettingsPanel {
  private readonly el: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly settings: SettingsStore
  private shown = false

  constructor(root: HTMLElement, settings: SettingsStore) {
    this.settings = settings
    const s = settings.get()

    this.el = document.createElement('div')
    this.el.className = 'settings-panel'
    this.el.style.display = 'none'

    const sens = SETTINGS_RANGES.sensitivity
    this.el.innerHTML = `
      <div class="settings-card">
        <h2>settings</h2>
        <div class="settings-row">
          <label>volume <span class="val" data-val="volume"></span></label>
          <input type="range" data-set="volume" min="0" max="100" step="1">
        </div>
        <div class="settings-row">
          <label>look sensitivity <span class="val" data-val="sensitivity"></span></label>
          <input type="range" data-set="sensitivity" min="${sens.min}" max="${sens.max}" step="${sens.step}">
        </div>
        <div class="settings-row toggle">
          <label><span>reduce intensity</span><input type="checkbox" data-set="reduceIntensity"></label>
        </div>
        <button class="settings-close" type="button">close</button>
      </div>`
    root.appendChild(this.el)
    this.card = this.el.querySelector('.settings-card') as HTMLDivElement

    // init controls from the store
    const volEl = this.input('volume')
    const sensEl = this.input('sensitivity')
    const reduceEl = this.input('reduceIntensity')
    volEl.value = String(s.volume)
    sensEl.value = String(s.sensitivity)
    reduceEl.checked = s.reduceIntensity
    this.renderValues()

    volEl.addEventListener('input', () => {
      settings.set({ volume: Number(volEl.value) })
      this.renderValues()
    })
    sensEl.addEventListener('input', () => {
      settings.set({ sensitivity: Number(sensEl.value) })
      this.renderValues()
    })
    reduceEl.addEventListener('change', () => {
      settings.set({ reduceIntensity: reduceEl.checked })
    })

    const close = this.el.querySelector('.settings-close') as HTMLButtonElement
    close.addEventListener('click', () => this.close())
    // click outside the card closes
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close()
    })
  }

  private input(name: string): HTMLInputElement {
    return this.el.querySelector(`[data-set="${name}"]`) as HTMLInputElement
  }

  private renderValues(): void {
    const s = this.settings.get()
    const vVol = this.el.querySelector('[data-val="volume"]') as HTMLElement
    const vSens = this.el.querySelector('[data-val="sensitivity"]') as HTMLElement
    vVol.textContent = `${Math.round(s.volume)}`
    // show sensitivity as a multiplier relative to the CS default feel (0.022)
    vSens.textContent = `${(s.sensitivity / 0.022).toFixed(2)}x`
  }

  get visible(): boolean {
    return this.shown
  }

  open(): void {
    if (this.shown) return
    this.shown = true
    this.el.style.display = 'flex'
    const reduce = this.settings.reduceMotion
    gsap.killTweensOf([this.el, this.card])
    gsap.fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: reduce ? 0 : 0.2, ease: 'power1.out' })
    gsap.fromTo(
      this.card,
      { scale: reduce ? 1 : 0.92, opacity: 0 },
      { scale: 1, opacity: 1, duration: reduce ? 0 : 0.28, ease: 'back.out(1.6)' },
    )
  }

  close(): void {
    if (!this.shown) return
    this.shown = false
    const reduce = this.settings.reduceMotion
    gsap.killTweensOf([this.el, this.card])
    gsap.to(this.card, { scale: reduce ? 1 : 0.94, opacity: 0, duration: reduce ? 0 : 0.18, ease: 'power1.in' })
    gsap.to(this.el, {
      opacity: 0,
      duration: reduce ? 0 : 0.18,
      ease: 'power1.in',
      onComplete: () => {
        this.el.style.display = 'none'
      },
    })
  }

  toggle(): void {
    if (this.shown) this.close()
    else this.open()
  }
}
