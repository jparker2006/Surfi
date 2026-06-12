import * as THREE from 'three'
import { consts } from './physics/constants'

// First person camera. Config FOV is Source style horizontal at 4:3; convert
// to the vertical FOV Three.js expects. Like Source this is hor+ scaling:
// the 4:3 relative vertical FOV stays constant across aspect ratios.
export function horizontalToVerticalFov(hFovDeg: number): number {
  const h = THREE.MathUtils.degToRad(hFovDeg)
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) * 0.75))
}

const eyePrev = new THREE.Vector3()

export class FPSCamera {
  readonly camera: THREE.PerspectiveCamera

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(
      horizontalToVerticalFov(consts.fov), aspect, 1, 60000,
    )
    this.camera.rotation.order = 'YXZ'
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  setHorizontalFov(hFovDeg: number): void {
    this.camera.fov = horizontalToVerticalFov(hFovDeg)
    this.camera.updateProjectionMatrix()
  }

  // Interpolate between the previous and current tick positions; the eye sits
  // eyeHeight above the feet, and pos is the hull center.
  update(prevPos: THREE.Vector3, currPos: THREE.Vector3, alpha: number, yaw: number, pitch: number): void {
    const eyeOffset = consts.eyeHeight - consts.hullHeight / 2
    eyePrev.copy(prevPos).lerp(currPos, alpha)
    this.camera.position.set(eyePrev.x, eyePrev.y + eyeOffset, eyePrev.z)
    this.camera.rotation.y = yaw
    this.camera.rotation.x = pitch
  }
}
