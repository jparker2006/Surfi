import * as THREE from 'three'
import type { AestheticConfig } from '../../levels/types'

// The acid look, rebuilt as flowing thin-film iridescence. A domain warped fbm
// field drives an IQ cosine palette tuned for a full spectrum rainbow, so the
// color reads as soap bubble / oil slick marbling: smooth organic bands that
// melt into each other, no hard edges, no repeating sine stripes. A fullscreen
// background dome renders the same field so the negative space is liquid color
// instead of a black void. Ramps add a fresnel edge glow and gentle form
// shading so the surface stays clearly readable.
//
// Flow and palette cycle are advanced by INTEGRATING a rate every frame, never
// modulo wrapped, so the color is continuous in time: no 1.0 -> 0.0 hue jump,
// no flash. Speed intensity accelerates the flow, lifts saturation and
// brightness, and speeds the palette cycle.

const TAU = 6.283185307179586

// Shared noise: hash, gradient noise, fbm, two domain warps, IQ palette. The
// fbm octave count is a per material #define so the fullscreen background can
// run cheaper than the ramp. Inigo Quilez gradient noise + domain warp.
const NOISE = `
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < OCTAVES; i++) {
    s += a * gnoise(p);
    p = p * 2.02 + vec3(11.3, 7.1, 5.7);
    a *= 0.5;
  }
  return s;
}
// rich two level domain warp for the ramp surface (p2 = p + fbm(p + fbm(p)))
float warp2(vec3 p, float t, out float swirl) {
  vec3 q = vec3(fbm(p + vec3(0.0, 0.10 * t, 0.0)),
                fbm(p + vec3(5.2, 1.3, 2.8)),
                fbm(p + vec3(1.7, 9.2, 4.4) - vec3(0.0, 0.0, 0.08 * t)));
  vec3 r = vec3(fbm(p + 3.0 * q + vec3(1.7, 9.2, 0.0)),
                fbm(p + 3.0 * q + vec3(8.3, 2.8, 5.1) + vec3(0.0, 0.12 * t, 0.0)),
                fbm(p + 3.0 * q + vec3(2.1, 6.3, 1.0)));
  swirl = q.x;
  return fbm(p + 3.5 * r);
}
// cheaper single level warp for the fullscreen background. This covers the
// whole frame (the dominant fragment cost), so it is deliberately lean: a two
// component warp reused for the third axis, and few octaves. The field stays
// smooth and organic at this scale, so the saving is invisible.
float warp1(vec3 p, float t, out float swirl) {
  vec2 q = vec2(fbm(p + vec3(0.0, 0.08 * t, 0.0)),
                fbm(p + vec3(3.2, 1.3, 2.8) - vec3(0.06 * t, 0.0, 0.0)));
  swirl = q.y;
  return fbm(p + 3.0 * vec3(q.x, q.y, q.x));
}
// IQ cosine palette, tuned for a full spectrum iridescent rainbow
vec3 iris(float t, float sat) {
  return vec3(0.5) + vec3(sat) * cos(6.28318530718 * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
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
#define OCTAVES 4
precision highp float;
uniform float uFlow;
uniform float uCycle;
uniform float uIntensity;
uniform float uValue;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFlat;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFogDepth;
${NOISE}
void main() {
  // test-only flat control: form shading only, no field / fresnel / fog, so a
  // screenshot or scanline reveals pure mesh geometry (are there any lines that
  // are NOT the shader?). default uFlat = 0, the real path below.
  if (uFlat > 0.5) {
    vec3 Lf = normalize(vec3(0.35, 0.85, 0.20));
    float lamf = 0.6 + 0.4 * clamp(dot(normalize(vNormal), Lf), -1.0, 1.0);
    gl_FragColor = vec4(vec3(0.7) * lamf, 1.0);
    return;
  }
  // fine grain marbled field in world space, flowing through the warp in time
  vec3 sp = vWorld * 0.0017;
  float swirl;
  float field = warp2(sp, uFlow, swirl);
  float t = field * 0.6 + swirl * 0.28 + uCycle;
  // speed expresses as SATURATION, not brightness: a higher cosine amplitude
  // clips the channels into punchier, more saturated color while the average
  // brightness stays roughly flat, so bloom never blows the frame to white
  float sat = mix(0.45, 0.6, uIntensity);
  vec3 col = iris(t, sat);
  // high key luminous tone, roughly constant across speed
  col = col * 0.92 + 0.05;
  // gentle form shading so the ramp tilt reads (fixed key light, never flat)
  vec3 L = normalize(vec3(0.35, 0.85, 0.20));
  float lambert = 0.82 + 0.18 * clamp(dot(normalize(vNormal), L), -1.0, 1.0);
  col *= lambert;
  // fresnel edge glow: bright iridescent rim along the silhouette and ridge,
  // the main legibility cue for where the ramp is and which way it leans
  vec3 vdir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(vdir, normalize(vNormal))), 2.4);
  vec3 rim = iris(t + 0.4, 0.5);
  col += rim * fres * (0.35 + 0.25 * uIntensity);
  col *= uValue;
  // fade distance into luminous fog color (matches the background tone), so the
  // far course melts into light instead of a black void
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(fogF, 0.0, 1.0)), 1.0);
}
`

const BG_VERT = `
varying vec3 vDir;
void main() {
  // dome is recentered on the camera every frame, so the local vertex position
  // is exactly the world view direction
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const BG_FRAG = `
#define OCTAVES 2
precision highp float;
uniform float uFlow;
uniform float uCycle;
uniform float uIntensity;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 sp = vDir * 2.3 + vec3(0.0, 0.0, uFlow * 0.04);
  float swirl;
  float field = warp1(sp, uFlow, swirl);
  // background rides the SAME cycle as the ramp but a near complementary phase
  // (+0.45) off it, so ramp and field always contrast in hue and the ramp stays
  // readable no matter where the cycle is
  float t = field * 0.7 + swirl * 0.22 + uCycle + 0.45;
  float sat = mix(0.42, 0.55, uIntensity);
  vec3 col = iris(t, sat);
  // a touch dimmer than the ramp, and dimming further with speed so the ramp
  // tunnel pops forward against the field instead of washing into it
  col = col * mix(0.66, 0.52, uIntensity) + 0.04;
  gl_FragColor = vec4(col, 1.0);
}
`

export class PaletteDriver {
  readonly rampMaterial: THREE.ShaderMaterial
  readonly platformMaterial: THREE.ShaderMaterial
  readonly background: THREE.Mesh
  readonly fogColor = new THREE.Color()
  private readonly cfg: AestheticConfig
  // monotonic accumulators: never modulo wrapped, so color is continuous in time
  private flow = 0
  private cycle: number
  private readonly bgMat: THREE.ShaderMaterial
  private readonly scratch = new THREE.Color()

  // flow speed through the warp, in noise units/sec (at rest, plus speed boost)
  private static readonly FLOW_BASE = 0.05
  private static readonly FLOW_BOOST = 0.55
  // palette cycle drift, in palette periods/sec (at rest, plus speed boost)
  private static readonly CYCLE_BASE = 0.012
  private static readonly CYCLE_BOOST = 0.08

  get currentHue(): number {
    // normalized palette phase, for the particle tint
    return this.cycle - Math.floor(this.cycle)
  }

  constructor(cfg: AestheticConfig) {
    this.cfg = cfg
    this.cycle = cfg.baseHue

    const makeRamp = (value: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: RAMP_VERT,
        fragmentShader: RAMP_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPulse: { value: 0 },
          uFlow: { value: 0 },
          uCycle: { value: this.cycle },
          uIntensity: { value: 0 },
          uFogColor: { value: new THREE.Color(cfg.fogColor) },
          uFogDensity: { value: cfg.fogDensity },
          uValue: { value: value },
          uFlat: { value: 0 },
        },
      })

    this.rampMaterial = makeRamp(1.0)
    this.platformMaterial = makeRamp(0.82)

    // fullscreen background dome, recentered on the camera each frame
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      uniforms: {
        uFlow: { value: 0 },
        uCycle: { value: this.cycle },
        uIntensity: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    })
    this.background = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 20), this.bgMat)
    this.background.frustumCulled = false
    this.background.renderOrder = -1000

    // initialize the fog color from the palette so the very first frame is
    // already correct (no uninitialized-uniform flash on load)
    this.computeFogColor()
  }

  // current iridescent accent for the HUD, sampled off the same integrated
  // cycle the world uses (so the UI breathes with the shader). phaseOffset lets
  // callers pull distinct-but-coherent accents (speed vs distance vs wipeout).
  sampleAccent(out: THREE.Color, phaseOffset = 0): THREE.Color {
    this.sampleIris(this.cycle + phaseOffset, 0.6, out)
    return out
  }

  // IQ palette evaluated on the CPU, for the fog color and any tint
  private sampleIris(t: number, sat: number, out: THREE.Color): void {
    out.setRGB(
      0.5 + sat * Math.cos(TAU * (t + 0.0)),
      0.5 + sat * Math.cos(TAU * (t + 0.33)),
      0.5 + sat * Math.cos(TAU * (t + 0.67)),
    )
  }

  private computeFogColor(intensity = 0): void {
    // a bright, lightly desaturated palette color so distance fades into light
    this.sampleIris(this.cycle * 0.85 + 0.18, 0.42, this.scratch)
    const lift = 0.5 + 0.25 * intensity
    this.fogColor.setRGB(
      this.scratch.r * (0.6 + 0.3 * intensity) + lift * 0.35,
      this.scratch.g * (0.6 + 0.3 * intensity) + lift * 0.35,
      this.scratch.b * (0.6 + 0.3 * intensity) + lift * 0.35,
    )
  }

  // dt in seconds (already clamped against frame hitches), intensity 0..1,
  // camPos to recenter the background dome
  update(dt: number, time: number, intensity: number, camPos: THREE.Vector3): void {
    this.flow += (PaletteDriver.FLOW_BASE + PaletteDriver.FLOW_BOOST * intensity) * dt
    this.cycle += (PaletteDriver.CYCLE_BASE + PaletteDriver.CYCLE_BOOST * intensity) * dt
    this.computeFogColor(intensity)

    for (const m of [this.rampMaterial, this.platformMaterial]) {
      m.uniforms.uTime.value = time
      m.uniforms.uFlow.value = this.flow
      m.uniforms.uCycle.value = this.cycle
      m.uniforms.uIntensity.value = intensity
      m.uniforms.uPulse.value = this.cfg.pulseAmount * (1.5 + 4 * intensity)
      ;(m.uniforms.uFogColor.value as THREE.Color).copy(this.fogColor)
    }

    this.bgMat.uniforms.uFlow.value = this.flow
    this.bgMat.uniforms.uCycle.value = this.cycle
    this.bgMat.uniforms.uIntensity.value = intensity
    this.background.position.copy(camPos)
  }
}
