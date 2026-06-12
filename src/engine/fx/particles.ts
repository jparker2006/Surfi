import * as THREE from 'three'
import type { AestheticConfig } from '../../levels/types'

// Speed trail particle field: points scattered in a large box that wraps
// around the player in the vertex shader, so there are zero per-frame CPU
// writes. Speed intensity drives size, brightness, and streak feel.

const VERT = `
attribute float seed;
uniform vec3 uCenter;
uniform float uIntensity;
varying float vSeed;
const vec3 BOX = vec3(5200.0, 3200.0, 5200.0);
void main() {
  vSeed = seed;
  vec3 rel = mod(position - uCenter + BOX * 0.5, BOX) - BOX * 0.5;
  vec4 mv = viewMatrix * vec4(rel + uCenter, 1.0);
  float dist = max(60.0, -mv.z);
  gl_PointSize = (1.0 + uIntensity * 5.0) * (1.0 + fract(seed * 13.7) * 2.0) * (420.0 / dist);
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = `
uniform float uIntensity;
uniform float uHue;
varying float vSeed;
vec3 hsv(float h, float s, float v) {
  vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
  vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c));
  vec3 col = hsv(uHue + vSeed * 0.4, 0.75, 1.0);
  gl_FragColor = vec4(col, a * (0.06 + 0.5 * uIntensity));
}
`

export class ParticleField {
  readonly points: THREE.Points
  private readonly mat: THREE.ShaderMaterial

  constructor(cfg: AestheticConfig) {
    const count = cfg.particles.count
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 5200
      pos[i * 3 + 1] = (Math.random() - 0.5) * 3200
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5200
      seed[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1))
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uIntensity: { value: 0 },
        uHue: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.frustumCulled = false
  }

  update(center: THREE.Vector3, intensity: number, hue: number): void {
    ;(this.mat.uniforms.uCenter.value as THREE.Vector3).copy(center)
    this.mat.uniforms.uIntensity.value = intensity
    this.mat.uniforms.uHue.value = hue
  }
}
