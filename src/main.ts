import * as THREE from 'three'
import './style.css'
import { consts } from './engine/physics/constants'
import { boxBrush, prismBrush, brushGeometry, brushWireframe, type Brush } from './engine/physics/brushes'
import { PlayerController } from './engine/physics/controller'
import { FixedLoop } from './engine/loop'
import { InputSystem } from './engine/input'
import { FPSCamera } from './engine/camera'
import { Hud } from './engine/hud'
import { DebugPanel } from './engine/debugpanel'
import { installTestApi, updateTestApi, isTestMode } from './testapi'

// Milestone 1: movement core. One grey test ramp, a spawn platform, a void.
// The only thing that matters here is that the surf physics feels right.

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

// test world: spawn platform, main ramp, transfer ramp
const SPAWN = new THREE.Vector3(0, 36.1, 40)
const KILL_Y = -2600

const brushes: Brush[] = [
  // spawn platform, top at y = 0
  boxBrush(new THREE.Vector3(-128, -64, -128), new THREE.Vector3(128, 0, 128)),
  // main ramp: ridge along -z, sides at about 54.5 degrees (n.y = 0.58, surfable)
  prismBrush(
    new THREE.Vector3(0, -100, -200),
    new THREE.Vector3(-400, -660, -200),
    new THREE.Vector3(400, -660, -200),
    new THREE.Vector3(0, 0, -1),
    3200,
  ),
  // transfer ramp: offset right and lower, requires carrying speed
  prismBrush(
    new THREE.Vector3(250, -800, -3700),
    new THREE.Vector3(-150, -1360, -3700),
    new THREE.Vector3(650, -1360, -3700),
    new THREE.Vector3(0, 0, -1),
    2400,
  ),
]

const platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.9 })
const rampMat = new THREE.MeshStandardMaterial({ color: 0x70707e, roughness: 0.8, flatShading: true })
const wireMat = new THREE.LineBasicMaterial({ color: 0x00ff88 })

const wireGroup = new THREE.Group()
wireGroup.visible = false
scene.add(wireGroup)

brushes.forEach((b, i) => {
  const mesh = new THREE.Mesh(brushGeometry(b), i === 0 ? platformMat : rampMat)
  scene.add(mesh)
  wireGroup.add(new THREE.LineSegments(brushWireframe(b), wireMat))
})

// player + systems
const controller = new PlayerController()
const prevPos = new THREE.Vector3()
controller.pos.copy(SPAWN)
prevPos.copy(SPAWN)

const input = new InputSystem(testMode)
input.attach(renderer.domElement)

const fpsCamera = new FPSCamera(window.innerWidth / window.innerHeight)
const hud = new Hud(app)
const panel = new DebugPanel(
  (on) => { wireGroup.visible = on },
  () => fpsCamera.setHorizontalFov(consts.fov),
)

input.onToggleDebug = () => panel.toggle()
input.onRespawn = respawn

function respawn(): void {
  controller.pos.copy(SPAWN)
  prevPos.copy(SPAWN)
  controller.vel.set(0, 0, 0)
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
  } else {
    controller.tick(input.frame(), brushes, TICK_DT)
    if (controller.pos.y < KILL_Y) respawn()
  }
  updateTestApi(surf, controller, 0, loop.tickCount)
}

function render(alpha: number): void {
  fpsCamera.update(prevPos, controller.pos, alpha, input.yaw, input.pitch)
  hud.setSpeed(Math.hypot(controller.vel.x, controller.vel.z))
  panel.setFps(loop.fps)
  renderer.render(scene, fpsCamera.camera)

  if (!testMode) {
    if (input.pointerLocked) hud.hideOverlay()
    else hud.showOverlay('<h1>SURFI</h1><p>click to surf</p><p class="hint">WASD move, mouse steer, space jump, R respawn</p>')
  }
}

const loop = new FixedLoop(TICK_DT, tick, render)

const surf = installTestApi(controller, input, tick)
updateTestApi(surf, controller, 0, 0)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  fpsCamera.setAspect(window.innerWidth / window.innerHeight)
})

loop.start()
