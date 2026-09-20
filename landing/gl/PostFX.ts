import * as THREE from "three";

// Post pass on a render target (spec E1 item 8). Pass one does the directional
// blurs (zoom toward a focus point, horizontal truck blur). Pass two does the
// focus blur, veil gradient, exposure, film grain, and an optional snapshot
// crossfade used when reduced motion replaces camera moves.

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const directional = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform float uZoom;
  uniform float uHorizontal;
  uniform vec2 uFocus;
  uniform float uTaps;

  void main() {
    if (uZoom < 0.001 && uHorizontal < 0.001) { gl_FragColor = texture2D(uTex, vUv); return; }
    vec2 toFocus = uFocus - vUv;
    // zoom blur grows from the edges toward the center
    float edge = smoothstep(0.0, 0.75, length(toFocus));
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 12; i++) {
      if (float(i) >= uTaps) break;
      float t = float(i) / (uTaps - 1.0);
      vec2 uv = vUv + toFocus * t * uZoom * 0.34 * edge + vec2((t - 0.5) * uHorizontal * 0.11, 0.0);
      float w = 1.0 - abs(t - 0.5) * 0.6;
      sum += texture2D(uTex, uv).rgb * w;
      total += w;
    }
    gl_FragColor = vec4(sum / total, 1.0);
  }
`;

const finish = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform sampler2D uSnapTex;
  uniform float uSnap;
  uniform float uFocusBlur;
  uniform float uVeil;
  uniform float uExposure;
  uniform float uGrain;
  uniform float uTime;
  uniform float uTaps;
  uniform vec2 uResolution;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 color;
    if (uFocusBlur < 0.001) {
      color = texture2D(uTex, vUv).rgb;
    } else {
      // golden angle disc, rotated per pixel so the low tap count turns into grain
      float spin = hash(vUv * uResolution) * 6.2831;
      vec2 px = uFocusBlur * 22.0 / uResolution;
      vec3 sum = texture2D(uTex, vUv).rgb;
      float total = 1.0;
      for (int i = 1; i < 18; i++) {
        if (float(i) >= uTaps) break;
        float r = sqrt(float(i) / uTaps);
        float a = float(i) * 2.39996 + spin;
        sum += texture2D(uTex, vUv + vec2(cos(a), sin(a)) * r * px).rgb;
        total += 1.0;
      }
      color = sum / total;
    }

    // veil: 25 percent black at the top, 50 percent at the bottom
    color *= 1.0 - uVeil * mix(0.5, 0.25, vUv.y);
    color *= uExposure;

    float g = hash(vUv * uResolution + fract(uTime) * 91.7) - 0.5;
    color += g * uGrain * 0.09;

    if (uSnap > 0.001) color = mix(color, texture2D(uSnapTex, vUv).rgb, uSnap);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface PostValues {
  zoom: number;
  horizontal: number;
  focus: number;
  veil: number;
  exposure: number;
  grain: number;
  freeze: number;
}

export class PostFX {
  values: PostValues = { zoom: 0, horizontal: 0, focus: 0, veil: 0, exposure: 1, grain: 0.55, freeze: 0 };
  focusPoint = new THREE.Vector2(0.5, 0.5);
  lowQuality = false;

  private rtScene: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private rtSnap: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private matDirectional: THREE.ShaderMaterial;
  private matFinish: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
    this.rtBlur = new THREE.WebGLRenderTarget(2, 2, opts);
    this.rtSnap = new THREE.WebGLRenderTarget(2, 2, opts);
    for (const rt of [this.rtScene, this.rtBlur, this.rtSnap]) {
      rt.texture.wrapS = rt.texture.wrapT = THREE.MirroredRepeatWrapping;
    }

    this.matDirectional = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: directional,
      depthTest: false,
      uniforms: {
        uTex: { value: this.rtScene.texture },
        uZoom: { value: 0 },
        uHorizontal: { value: 0 },
        uFocus: { value: this.focusPoint },
        uTaps: { value: 12 },
      },
    });
    this.matFinish = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: finish,
      depthTest: false,
      uniforms: {
        uTex: { value: this.rtBlur.texture },
        uSnapTex: { value: this.rtSnap.texture },
        uSnap: { value: 0 },
        uFocusBlur: { value: 0 },
        uVeil: { value: 0 },
        uExposure: { value: 1 },
        uGrain: { value: 0.55 },
        uTime: { value: 0 },
        uTaps: { value: 18 },
        uResolution: { value: new THREE.Vector2(2, 2) },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matDirectional);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  resize(w: number, h: number, dpr: number) {
    const pw = Math.max(2, Math.round(w * dpr));
    const ph = Math.max(2, Math.round(h * dpr));
    this.rtScene.setSize(pw, ph);
    this.rtBlur.setSize(pw, ph);
    this.rtSnap.setSize(pw, ph);
    this.matFinish.uniforms.uResolution.value.set(pw, ph);
  }

  private sync(time: number) {
    const d = this.matDirectional.uniforms;
    const f = this.matFinish.uniforms;
    d.uZoom.value = this.values.zoom;
    d.uHorizontal.value = this.values.horizontal;
    d.uTaps.value = this.lowQuality ? 6 : 12;
    f.uFocusBlur.value = this.values.focus;
    f.uVeil.value = this.values.veil;
    f.uExposure.value = this.values.exposure;
    f.uGrain.value = this.values.grain;
    f.uSnap.value = this.values.freeze;
    f.uTaps.value = this.lowQuality ? 9 : 18;
    f.uTime.value = time;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number, target: THREE.WebGLRenderTarget | null = null) {
    this.sync(time);
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    this.quad.material = this.matDirectional;
    r.setRenderTarget(this.rtBlur);
    r.render(this.quadScene, this.quadCamera);

    this.quad.material = this.matFinish;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.quadCamera);
    r.setRenderTarget(null);
  }

  /** Freeze the current frame so the next one can crossfade in from it. */
  snapshot(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    const keep = this.values.freeze;
    this.values.freeze = 0;
    this.render(scene, camera, time, this.rtSnap);
    this.values.freeze = keep;
  }

  dispose() {
    this.rtScene.dispose();
    this.rtBlur.dispose();
    this.rtSnap.dispose();
    this.matDirectional.dispose();
    this.matFinish.dispose();
    this.quad.geometry.dispose();
  }
}
