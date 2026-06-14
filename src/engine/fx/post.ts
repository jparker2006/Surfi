import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { AestheticConfig } from '../../levels/types'

// Postprocessing chain: bloom, then a combined chromatic aberration and
// vignette pass. All intensities map from the one normalized speed value
// through curves owned by the level config.

const CA_VIGNETTE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCA: { value: 0 },
    uVig: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uCA;
    uniform float uVig;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * (uCA * (0.4 + r2 * 2.4));
      float rr = texture2D(tDiffuse, vUv + off).r;
      float gg = texture2D(tDiffuse, vUv).g;
      float bb = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(rr, gg, bb);
      col *= 1.0 - uVig * smoothstep(0.3, 1.1, length(c) * 1.7);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export class PostChain {
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly caPass: ShaderPass
  private readonly cfg: AestheticConfig

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cfg: AestheticConfig,
  ) {
    this.cfg = cfg
    this.composer = new EffectComposer(renderer)
    this.composer.addPass(new RenderPass(scene, camera))
    // high threshold: the scene is now inherently bright (luminous iridescence),
    // so bloom is a halo on the brightest rims only, never a full frame wash
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
      cfg.bloom.base,
      0.4,
      0.8,
    )
    this.composer.addPass(this.bloom)
    this.caPass = new ShaderPass(CA_VIGNETTE)
    this.composer.addPass(this.caPass)
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h)
  }

  // current bloom strength, for the fx diagnostics probe
  get bloomStrength(): number {
    return this.bloom.strength
  }

  update(intensity: number): void {
    const c = this.cfg
    this.bloom.strength = c.bloom.base + (c.bloom.max - c.bloom.base) * intensity
    this.caPass.uniforms.uCA.value = c.chromatic.base + (c.chromatic.max - c.chromatic.base) * intensity
    this.caPass.uniforms.uVig.value = c.vignette * (0.55 + 0.45 * intensity)
  }

  render(): void {
    this.composer.render()
  }
}
