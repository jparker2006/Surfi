import gsap from 'gsap'
import { LEVEL_TILES, type LevelTile } from '../levels'
import { SettingsStore } from '../engine/settings'
import { SettingsPanel } from './settings'

// Entry landing: title + level select + settings, over the live iridescence
// shader (the scene renders behind this translucent layer). GSAP drives a
// staggered intro, tile hovers, and a zoom-into-tunnel transition on launch.
// The launch callback is invoked synchronously from the tile click so the host
// can request pointer lock inside the user gesture.

const SEEN_KEY = 'surfi:seenLanding'

export interface LandingOpts {
  onLaunch: (tile: LevelTile) => void
}

export class Landing {
  private readonly el: HTMLDivElement
  private readonly settings: SettingsStore
  private readonly panel: SettingsPanel
  private readonly opts: LandingOpts
  private intro: gsap.core.Timeline | null = null
  private shown = false

  constructor(root: HTMLElement, settings: SettingsStore, panel: SettingsPanel, opts: LandingOpts) {
    this.settings = settings
    this.panel = panel
    this.opts = opts

    this.el = document.createElement('div')
    this.el.className = 'landing'
    this.el.style.display = 'none'

    const tiles = LEVEL_TILES.map((t) => {
      const soon = t.status !== 'playable'
      return `
        <button class="tile${soon ? ' soon' : ''}" type="button" data-id="${t.id}"${soon ? ' disabled' : ''}>
          <div class="tile-title">${t.title}</div>
          <div class="tile-sub">${t.subtitle ?? ''}</div>
          <div class="tile-go">${soon ? 'coming soon' : 'surf &rsaquo;'}</div>
        </button>`
    }).join('')

    this.el.innerHTML = `
      <h1 class="landing-title">SURFI</h1>
      <p class="landing-tagline">source surf, in the browser</p>
      <div class="landing-tiles">${tiles}</div>
      <button class="landing-settings-btn" type="button">settings</button>
      <div class="landing-hint">
        <p>WASD plus mouse to surf. Strafe into the ramp face to gain speed.</p>
        <p>Space to jump. R to respawn. Backtick or F3 for the debug panel.</p>
      </div>`
    root.appendChild(this.el)

    // launch playable tiles; the click is the user gesture the host needs for
    // pointer lock, so onLaunch is called synchronously here
    for (const btn of Array.from(this.el.querySelectorAll<HTMLButtonElement>('.tile:not(.soon)'))) {
      const id = btn.dataset.id
      const tile = LEVEL_TILES.find((t) => t.id === id)
      if (!tile) continue
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.opts.onLaunch(tile)
      })
      btn.addEventListener('pointerenter', () => {
        if (this.settings.reduceMotion) return
        gsap.to(btn, { scale: 1.05, duration: 0.18, ease: 'power2.out' })
      })
      btn.addEventListener('pointerleave', () => {
        gsap.to(btn, { scale: 1, duration: 0.18, ease: 'power2.out' })
      })
    }

    const settingsBtn = this.el.querySelector('.landing-settings-btn') as HTMLButtonElement
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.panel.open()
    })

    // click on the backdrop during the intro skips it to the ready state
    this.el.addEventListener('click', () => {
      if (this.intro && this.intro.progress() < 1) this.intro.progress(1)
    })
  }

  get visible(): boolean {
    return this.shown
  }

  // show the landing; fast skips most of the intro (used by exit-to-menu and
  // returning players, so the animated entrance does not replay every time)
  show(opts: { fast?: boolean } = {}): void {
    if (this.shown) return
    this.shown = true
    this.el.style.display = 'flex'

    const seen = localStorage.getItem(SEEN_KEY) === '1'
    const reduce = this.settings.reduceMotion
    const fast = opts.fast || seen || reduce
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // ignore storage failure
    }

    const title = this.el.querySelector('.landing-title')
    const tagline = this.el.querySelector('.landing-tagline')
    const tilesRow = this.el.querySelector('.landing-tiles')
    const tileEls = Array.from(this.el.querySelectorAll('.tile'))
    const btn = this.el.querySelector('.landing-settings-btn')
    const hint = this.el.querySelector('.landing-hint')

    if (this.intro) this.intro.kill()
    gsap.set(this.el, { opacity: 1 })

    if (reduce) {
      // instant placement: no motion
      gsap.set([title, tagline, tilesRow, btn, hint, ...tileEls], { opacity: 1, y: 0, scale: 1 })
      this.intro = null
      return
    }

    const d = fast ? 0.18 : 0.5
    const tl = gsap.timeline()
    tl.fromTo(title, { opacity: 0, y: -24 }, { opacity: 1, y: 0, duration: d, ease: 'power3.out' })
    tl.fromTo(tagline, { opacity: 0 }, { opacity: 0.8, duration: d * 0.8 }, fast ? '<' : '-=0.2')
    tl.fromTo(
      tileEls,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: d, ease: 'back.out(1.5)', stagger: fast ? 0 : 0.08 },
      fast ? '<' : '-=0.15',
    )
    tl.fromTo([btn, hint], { opacity: 0 }, { opacity: 1, duration: d * 0.7, stagger: 0.05 }, '-=0.2')
    this.intro = tl
  }

  // zoom-into-tunnel transition, then hide and fire onComplete (host starts the
  // run there). Pointer lock has already been requested by the host before this.
  launchTransition(onComplete: () => void): void {
    const reduce = this.settings.reduceMotion
    if (this.intro) this.intro.progress(1)
    gsap.killTweensOf(this.el)
    if (reduce) {
      this.hide()
      onComplete()
      return
    }
    gsap.to(this.el, {
      scale: 1.6,
      opacity: 0,
      duration: 0.5,
      ease: 'power2.in',
      transformOrigin: 'center center',
      onComplete: () => {
        gsap.set(this.el, { scale: 1 })
        this.hide()
        onComplete()
      },
    })
  }

  hide(): void {
    this.shown = false
    this.el.style.display = 'none'
  }
}
