import * as THREE from 'three'
import './style.css'
import { consts } from './engine/physics/constants'
import { boxBrush, brushWireframe } from './engine/physics/brushes'
import { PlayerController } from './engine/physics/controller'
import { AnomalyRecorder } from './engine/physics/anomaly'
import { FixedLoop } from './engine/loop'
import { InputSystem } from './engine/input'
import { FPSCamera } from './engine/camera'
import { Hud } from './engine/hud'
import { DebugPanel } from './engine/debugpanel'
import { CourseGenerator } from './engine/gen/generator'
import { Game } from './engine/game'
import { Drone } from './engine/audio'
import { PaletteDriver } from './engine/fx/palette'
import { PostChain } from './engine/fx/post'
import { ParticleField } from './engine/fx/particles'
import { FxProbe } from './engine/fx/fxprobe'
import { acidsurf } from './levels/acidsurf'
import { LiveReadout } from './engine/livereadout'
import { installTestApi, updateTestApi, isTestMode } from './testapi'

// Engine bootstrap. The level is a plain config module; acidsurf is the
// hardcoded v1 level. No level select, no routing.

const level = acidsurf
Object.assign(consts, level.physics ?? {})

// Build stamp: identify the running build so a stale deploy is obvious. Logged
// on load (always) and shown in the debug readout.
const BUILD_LABEL = `${__BUILD_HASH__} @ ${__BUILD_TIME__}`
console.log(`SURFI build ${BUILD_LABEL}`)

const app = document.getElementById('app')!
const testMode = isTestMode()

// desktop only: touch devices get a styled blocker instead of the game
const touchDevice = !testMode && window.matchMedia('(hover: none) and (pointer: coarse)').matches
if (touchDevice) {
  app.innerHTML =
    '<div class="blocker"><h1>SURFI</h1>' +
    '<p>this one needs a keyboard and a mouse.<br>come back on a desktop to ride.</p></div>'
} else {
  boot()
}

function boot(): void {

  // renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  app.appendChild(renderer.domElement)

  const scene = new THREE.Scene()

  // the trip: iridescent flowing materials, fullscreen background field, fog
  // color, all speed-reactive
  const palette = new PaletteDriver(level.aesthetic)
  scene.background = palette.fogColor
  scene.add(palette.background)
  const particles = new ParticleField(level.aesthetic)
  scene.add(particles.points)

  // world: spawn platform at the origin feeding the generated course
  const SPAWN = new THREE.Vector3(0, 36.1, 40)
  // ridge offset left of the platform so walking off drops onto the right face,
  // CS surf style, instead of balancing on the apex crest
  const SPAWN_RIDGE = new THREE.Vector3(-150, -40, -200)

  const platform = boxBrush(new THREE.Vector3(-128, -64, -128), new THREE.Vector3(128, 0, 128))
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(256, 64, 256).translate(0, -32, 0), palette.platformMaterial))

  const gen = new CourseGenerator(level.generation, palette.rampMaterial, SPAWN_RIDGE)
  gen.addStatic(platform)
  scene.add(gen.group)

  // player + systems
  const controller = new PlayerController()
  const prevPos = new THREE.Vector3()
  controller.pos.copy(SPAWN)
  prevPos.copy(SPAWN)

  // anomaly recorder: dev/test only, drives the trap sweeps and regressions
  const recordingOn = import.meta.env.DEV || testMode
  const recorder = new AnomalyRecorder()
  controller.recording = recordingOn
  // sample every tick during play so the manual capture (K) and detector g have
  // a live rolling window. The test sweeps still toggle this around their runs.
  recorder.enabled = recordingOn

  const input = new InputSystem(testMode)
  input.attach(renderer.domElement)

  const fpsCamera = new FPSCamera(window.innerWidth / window.innerHeight)
  const hud = new Hud(app)
  // debug only: live contact readout, toggled with the debug panel
  const readout = new LiveReadout(app, BUILD_LABEL)
  const game = new Game(level, controller, gen, SPAWN, testMode)
  const drone = new Drone(level.audio)
  hud.setMuted(drone.muted)
  hud.onMuteToggle = () => {
    drone.ensureStarted()
    drone.toggleMute()
    hud.setMuted(drone.muted)
  }
  input.onToggleMute = () => {
    drone.ensureStarted()
    drone.toggleMute()
    hud.setMuted(drone.muted)
  }

  // debug wireframes rebuilt lazily from the live collision set
  const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff88 })
  const wireGroup = new THREE.Group()
  wireGroup.visible = false
  scene.add(wireGroup)
  let wireDirty = true

  // debug: a marker that flashes when the recorder catches an anomaly. The live
  // wireframes already show the contact geometry the player is pinned against.
  const anomalyMarker = document.createElement('div')
  anomalyMarker.className = 'anomaly-flash'
  app.appendChild(anomalyMarker)
  let lastDumpCount = 0
  let anomalyFlashUntil = 0

  function rebuildWires(): void {
    while (wireGroup.children.length > 0) {
      const c = wireGroup.children[0] as THREE.LineSegments
      wireGroup.remove(c)
      c.geometry.dispose()
    }
    for (const b of gen.collision) {
      wireGroup.add(new THREE.LineSegments(brushWireframe(b), wireMat))
    }
    wireDirty = false
  }

  const panel = new DebugPanel(
    (on) => {
      wireGroup.visible = on
      if (on) rebuildWires()
    },
    () => fpsCamera.setHorizontalFov(consts.fov),
  )
  input.onToggleDebug = () => {
    panel.toggle()
    readout.toggle(!readout.visible)
  }
  input.onRespawn = () => {
    if (game.state !== 'start') {
      game.startRun()
      snapToSpawn()
    }
  }

  // manual capture (K): dump the recorded state window to a downloadable JSON,
  // the human-in-the-loop ground truth pressed the instant they stick
  input.onCapture = () => {
    if (!recordingOn) return
    const snap = recorder.snapshot()
    const payload = {
      build: BUILD_LABEL,
      capturedAtDist: Math.round(game.liveDistance),
      ...snap,
      seed: game.runSeed,
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `surfi-capture-${snap.atTickId}.json`
    a.click()
    URL.revokeObjectURL(url)
    console.log(`SURFI capture: ${snap.frameCount} ticks at dist ${Math.round(game.liveDistance)}, seg ${gen.segmentAt(game.liveDistance)?.kind ?? '-'}`)
  }

  function snapToSpawn(): void {
    prevPos.copy(controller.pos)
    wireDirty = true
    // a fresh run: re-arm the recorder so its rolling window and course
    // tracking start from spawn (keeps capture dist/segment accurate)
    if (recordingOn) {
      recorder.reset(game.runSeed)
      recorder.enabled = true
    }
  }

  // fly / noclip
  const flyDir = new THREE.Vector3()
  function flyMove(dt: number): void {
    const f = input.frame()
    const speed = 1200
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw)
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch)
    const fmove = (f.forward ? 1 : 0) - (f.back ? 1 : 0)
    const smove = (f.right ? 1 : 0) - (f.left ? 1 : 0)
    flyDir.set(
      -sy * cp * fmove + cy * smove,
      sp * fmove + (f.jump ? 1 : 0),
      -cy * cp * fmove - sy * smove,
    )
    if (flyDir.lengthSq() > 0) flyDir.normalize()
    controller.pos.addScaledVector(flyDir, speed * dt)
    controller.vel.set(0, 0, 0)
  }

  // fixed timestep simulation
  const TICK_DT = 1 / consts.tickRate

  function tick(): void {
    prevPos.copy(controller.pos)
    if (panel.state.fly) {
      flyMove(TICK_DT)
    } else if (game.state === 'playing') {
      const f = input.frame()
      controller.tick(f, gen.collision, TICK_DT)
      game.onTick()
      if (controller.recording) recorder.sample(controller, f, gen)
    }
    updateTestApi(surf, controller, game, loop.tickCount)
  }

  // overlay management: re-render the overlay DOM only when the key changes
  let overlayKey = ''
  function syncOverlay(): void {
    let key: string
    if (game.state === 'start') {
      key = 'start'
    } else if (game.state === 'dead') {
      key = `dead:${Math.floor(game.distance)}`
    } else if (!testMode && !input.pointerLocked) {
      key = 'resume'
    } else {
      key = 'none'
    }
    if (key === overlayKey) return
    overlayKey = key

    if (key === 'start') {
      hud.showStart('SURFI', level.title, false)
      hud.setHudVisible(false)
    } else if (key === 'resume') {
      hud.showStart('SURFI', level.title, true)
    } else if (key.startsWith('dead')) {
      hud.showDeath({
        distance: game.distance,
        peakSpeed: game.peakSpeed,
        best: game.best,
        isNewBest: game.newBest,
      })
      hud.setHudVisible(false)
    } else {
      hud.hideOverlay()
      hud.setHudVisible(true)
    }
  }

  // fx state: one normalized speed intensity drives every effect
  const post = new PostChain(renderer, scene, fpsCamera.camera, level.aesthetic)
  // dev/test-only per-frame luminance + scanline diagnostics
  const fxProbe = recordingOn ? new FxProbe(renderer) : null
  let fxTimeLast = -1
  let smoothedIntensity = 0
  let currentHFov = consts.fov

  function render(alpha: number): void {
    fpsCamera.update(prevPos, controller.pos, alpha, input.yaw, input.pitch)
    const speed = Math.hypot(controller.vel.x, controller.vel.z)
    hud.setSpeed(speed)
    hud.setDistance(game.distance)
    panel.setFps(loop.fps)
    if (readout.visible) readout.update(controller, gen, game.liveDistance)
    if (wireGroup.visible && wireDirty) rebuildWires()
    syncOverlay()

    // flash the anomaly marker when a new dump lands while debug wires are on
    const nowMs = performance.now()
    if (recordingOn && recorder.dumps.length > lastDumpCount) {
      lastDumpCount = recorder.dumps.length
      if (wireGroup.visible) anomalyFlashUntil = nowMs + 400
    }
    anomalyMarker.style.opacity = nowMs < anomalyFlashUntil ? '1' : '0'

    const now = performance.now() / 1000
    // clamp the fx timestep against frame hitches (a segment spawn rebuilds
    // geometry on the main thread): a large dt would otherwise snap the smoothed
    // intensity and the integrated flow forward in one frame, reading as a flash
    const dt = fxTimeLast < 0 ? 0.016 : Math.min(0.05, now - fxTimeLast)
    fxTimeLast = now

    const raw = THREE.MathUtils.clamp(speed / level.aesthetic.speedForMaxFx, 0, 1)
    const target = raw * raw * (3 - 2 * raw) // smoothstep curve
    smoothedIntensity += (target - smoothedIntensity) * Math.min(1, dt * 5)

    // fov kick, horizontal degrees, smoothed
    const targetFov = consts.fov + level.aesthetic.fovKick * smoothedIntensity
    if (Math.abs(targetFov - currentHFov) > 0.01) {
      currentHFov += (targetFov - currentHFov) * Math.min(1, dt * 6)
      fpsCamera.setHorizontalFov(currentHFov)
    }

    palette.update(dt, now, smoothedIntensity, fpsCamera.camera.position)
    particles.update(fpsCamera.camera.position, smoothedIntensity, palette.currentHue)
    post.update(smoothedIntensity)
    drone.update(smoothedIntensity)
    post.render()

    // frame diagnostics: read the final back buffer for flash/line detection
    if (fxProbe) {
      fxProbe.frame({
        intensity: smoothedIntensity,
        speed,
        state: game.state,
        gen: gen.changeCount,
        runs: game.runCount,
      })
    }
  }

  const loop = new FixedLoop(TICK_DT, tick, render)
  // window.__surf and __surfInput exist in dev builds and under ?test=1 only
  const surf = installTestApi(controller, input, game, gen, tick, import.meta.env.DEV || testMode)
  if (recordingOn) {
    ;(window as unknown as Record<string, unknown>).__surfAnomaly = recorder
  }
  if (fxProbe) {
    ;(window as unknown as Record<string, unknown>).__surfFx = {
      start: () => fxProbe.start(),
      stop: () => fxProbe.stop(),
      get frames() {
        return fxProbe.frames
      },
      requestScanline: (fy: number, n: number) => fxProbe.requestScanline(fy, n),
      get scan() {
        return fxProbe.scanResult
      },
    }
  }
  if (testMode) {
    ;(window as unknown as Record<string, unknown>).__surfDebug = { gen, controller, game, consts, recorder, palette }
  }

  // flow: click starts (and pointer locks); any key respawns from death
  renderer.domElement.addEventListener('click', () => {
    drone.ensureStarted()
    if (game.state === 'start') {
      game.startRun()
      snapToSpawn()
    } else if (game.state === 'dead') {
      game.startRun()
      snapToSpawn()
    }
  })
  window.addEventListener('keydown', (e) => {
    if (game.state === 'dead' && e.code !== 'Backquote' && e.code !== 'F3') {
      game.startRun()
      snapToSpawn()
    }
  })

  // build a course behind the start screen so the world is never empty
  gen.reset(level.generation.fixedSeed)
  if (testMode) {
    game.startRun()
  }
  updateTestApi(surf, controller, game, 0)

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    post.setSize(window.innerWidth, window.innerHeight)
    fpsCamera.setAspect(window.innerWidth / window.innerHeight)
  })

  loop.start()
}
