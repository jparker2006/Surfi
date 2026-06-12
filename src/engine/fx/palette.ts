import * as THREE from 'three'
import type { AestheticConfig } from '../../levels/types'

// The acid look: unlit hue-cycling ramp shader with flow bands, fresnel edge
// glow, vertex pulse, and exponential fog, plus a starfield and animated fog
// color. One hue clock drives everything; speed intensity accelerates it.

const HSV = `
vec3 hsv(float h, float s, float v) {
  vec3 k = vec3(1.0, 2.0 / 3.0, 1.0 / 3.0);
  vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
`

const RAMP_VERT = `
uniform float uTime;
uniform float uPulse;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFogDepth;
void main() {
  vec3 p = position + normal * (sin(uTime * 1.7 + position.x * 0.011 + position.z * 0.013) * uPulse);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * w;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const RAMP_FRAG = `
uniform float uTime;
uniform float uHue;
uniform float uIntensity;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uValue;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFogDepth;
${HSV}
void main() {
  float hue = uHue + vWorld.y * 0.00035 + (vWorld.x + vWorld.z) * 0.00009;
  float flow = sin((vWorld.x + vWorld.z) * 0.016 - uTime * (1.2 + uIntensity * 7.0));
  // derivative aware band edges: widen the smoothstep by the per pixel rate of
  // change of flow so the bands read as a soft glow instead of hard stripes,
  // and never alias into thin lines at grazing angles down the ramp
  float w = fwidth(flow) + 0.06;
  float band = smoothstep(0.45 - w, 0.95 + w, flow);
  vec3 base = hsv(hue, 0.85, uValue * (0.38 + 0.3 * band));
  vec3 vdir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(vdir, normalize(vNormal))), 2.2);
  vec3 col = base + hsv(hue + 0.38, 0.9, 1.0) * fres * (0.22 + 0.3 * uIntensity);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(fogF, 0.0, 1.0)), 1.0);
}
`

const STAR_VERT = `
attribute float seed;
uniform float uTime;
varying float vSeed;
void main() {
  vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 1.5 + 2.5 * fract(seed * 7.31);
  gl_Position = projectionMatrix * mv;
}
`

const STAR_FRAG = `
uniform float uTime;
uniform float uHue;
varying float vSeed;
${HSV}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + vSeed * 2.0) + vSeed * 40.0);
  vec3 col = hsv(uHue + vSeed * 0.25, 0.55, 1.0);
  gl_FragColor = vec4(col, a * tw * 0.85);
}
`

export class PaletteDriver {
  readonly rampMaterial: THREE.ShaderMaterial
  readonly platformMaterial: THREE.ShaderMaterial
  readonly stars: THREE.Points
  readonly fogColor = new THREE.Color()
  private readonly cfg: AestheticConfig
  private hue: number

  get currentHue(): number {
    return this.hue
  }

  constructor(cfg: AestheticConfig) {
    this.cfg = cfg
    this.hue = cfg.baseHue

    const makeRamp = (value: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: RAMP_VERT,
        fragmentShader: RAMP_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uHue: { value: cfg.baseHue },
          uIntensity: { value: 0 },
          uFogColor: { value: new THREE.Color(cfg.fogColor) },
          uFogDensity: { value: cfg.fogDensity },
          uValue: { value: value },
        },
      })

    this.rampMaterial = makeRamp(0.52)
    this.platformMaterial = makeRamp(0.35)

    // starfield sphere, recentered on the camera every frame
    const COUNT = 1400
    const pos = new Float32Array(COUNT * 3)
    const seed = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * 2 - 1
      const phi = Math.random() * Math.PI * 2
      const r = 24000 + Math.random() * 14000
      const s = Math.sqrt(1 - u * u)
      pos[i * 3] = s * Math.cos(phi) * r
      pos[i * 3 + 1] = u * r
      pos[i * 3 + 2] = s * Math.sin(phi) * r
      seed[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1))
    const starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uHue: { value: cfg.baseHue },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.stars = new THREE.Points(geo, starMat)
    this.stars.frustumCulled = false
  }

  // dt in seconds, intensity 0..1, camPos for star recentering
  update(dt: number, time: number, intensity: number, camPos: THREE.Vector3): void {
    const rotPerMin = this.cfg.hueCycleSpeed + this.cfg.hueSpeedBoost * intensity
    this.hue = (this.hue + (rotPerMin / 60) * dt) % 1

    const fogHue = (this.hue * 0.5 + 0.62) % 1
    this.fogColor.setHSL(fogHue, 0.55, 0.05 + 0.05 * intensity)

    for (const m of [this.rampMaterial, this.platformMaterial]) {
      m.uniforms.uTime.value = time
      m.uniforms.uHue.value = this.hue
      m.uniforms.uIntensity.value = intensity
      m.uniforms.uPulse.value = this.cfg.pulseAmount * (2.5 + 7 * intensity)
      ;(m.uniforms.uFogColor.value as THREE.Color).copy(this.fogColor)
    }

    const sm = this.stars.material as THREE.ShaderMaterial
    sm.uniforms.uTime.value = time
    sm.uniforms.uHue.value = this.hue
    this.stars.position.copy(camPos)
  }
}
