import * as THREE from 'three'
import './style.css'
import { consts } from './engine/physics/constants'
import { boxBrush, brushWireframe } from './engine/physics/brushes'
import { PlayerController } from './engine/physics/controller'
import { FixedLoop } from './engine/loop'
import { InputSystem } from './engine/input'
import { FPSCamera } from './engine/camera'
import { Hud } from './engine/hud'
import { DebugPanel } from './engine/debugpanel'
import { CourseGenerator } from './engine/gen/generator'
import { Game } from './engine/game'
import { acidsurf } from './levels/acidsurf'
import { installTestApi, updateTestApi, isTestMode } from './testapi'

// Engine bootstrap. The level is a plain config module; acidsurf is the
// hardcoded v1 level. No level select, no routing.

const level = acidsurf
Object.assign(consts, level.physics ?? {})

const app = document.getElementById('app')!
const testMode = isTestMode()

// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0b12)

const hemi = new THREE.HemisphereLight(0x8899bb, 0x222233, 1.2)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.5)
sun.position.set(0.4, 1, 0.6)
scene.add(sun)

// world: spawn platform at the origin feeding the generated course
const SPAWN = new THREE.Vector3(0, 36.1, 40)
// ridge offset left of the platform so walking off drops onto the right face,
// CS surf style, instead of balancing on the apex crest
const SPAWN_RIDGE = new THREE.Vector3(-150, -40, -200)

const platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.9 })
const rampMat = new THREE.MeshStandardMaterial({ color: 0x70707e, roughness: 0.8, flatShading: true })

const platform = boxBrush(new THREE.Vector3(-128, -64, -128), new THREE.Vector3(128, 0, 128))
scene.add(new THREE.Mesh(new THREE.BoxGeometry(256, 64, 256).translate(0, -32, 0), platformMat))

const gen = new CourseGenerator(level.generation, rampMat, SPAWN_RIDGE)
gen.addStatic(platform)
scene.add(gen.group)

// player + systems
const controller = new PlayerController()
const prevPos = new THREE.Vector3()
controller.pos.copy(SPAWN)
prevPos.copy(SPAWN)

const input = new InputSystem(testMode)
input.attach(renderer.domElement)

const fpsCamera = new FPSCamera(window.innerWidth / window.innerHeight)
const hud = new Hud(app)
const game = new Game(level, controller, gen, SPAWN, testMode)

// debug wireframes rebuilt lazily from the live collision set
const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff88 })
const wireGroup = new THREE.Group()
wireGroup.visible = false
scene.add(wireGroup)
let wireDirty = true

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
input.onToggleDebug = () => panel.toggle()
input.onRespawn = () => {
  if (game.state !== 'start') {
    game.startRun()
    snapToSpawn()
  }
}

function snapToSpawn(): void {
  prevPos.copy(controller.pos)
  wireDirty = true
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
    controller.tick(input.frame(), gen.collision, TICK_DT)
    game.onTick()
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

function render(alpha: number): void {
  fpsCamera.update(prevPos, controller.pos, alpha, input.yaw, input.pitch)
  hud.setSpeed(Math.hypot(controller.vel.x, controller.vel.z))
  hud.setDistance(game.distance)
  panel.setFps(loop.fps)
  if (wireGroup.visible && wireDirty) rebuildWires()
  syncOverlay()
  renderer.render(scene, fpsCamera.camera)
}

const loop = new FixedLoop(TICK_DT, tick, render)
const surf = installTestApi(controller, input, game, gen, tick)
if (testMode) {
  ;(window as unknown as Record<string, unknown>).__surfDebug = { gen, controller, game, consts }
}

// flow: click starts (and pointer locks); any key respawns from death
renderer.domElement.addEventListener('click', () => {
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
  fpsCamera.setAspect(window.innerWidth / window.innerHeight)
})

loop.start()
