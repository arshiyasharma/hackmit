import * as THREE from "three";

// Facade module material (spec E1 item 3): cuts a feathered rectangular hole at
// the window rect so the room plane behind it shows through, and multiplies
// drifting tree shadows over the wall. When V_shadow_loop is missing, a soft
// procedural shadow stands in.

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform sampler2D uShadow;
  uniform float uHasShadow;
  uniform float uShadowAmount;
  uniform vec4 uWindow;   // x, y, w, h in uv from the top left
  uniform vec2 uSize;     // module size in px
  uniform float uFeather; // px
  uniform float uOpacity;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 tl = vec2(vUv.x, 1.0 - vUv.y);
    vec4 wall = texture2D(uTex, vUv);

    float shade;
    if (uHasShadow > 0.5) {
      shade = texture2D(uShadow, vUv).r;
    } else {
      vec2 p = tl * vec2(5.0, 3.2) + vec2(sin(uTime * 0.35) * 0.18, cos(uTime * 0.27) * 0.1);
      float leaves = fbm(p + fbm(p * 1.7 + uTime * 0.05));
      shade = 1.0 - smoothstep(0.48, 0.72, leaves) * 0.9;
    }
    wall.rgb *= mix(1.0, shade, uShadowAmount);

    // inside distance to the window rect, in pixels
    vec2 lo = (tl - uWindow.xy) * uSize;
    vec2 hi = (uWindow.xy + uWindow.zw - tl) * uSize;
    float inside = min(min(lo.x, lo.y), min(hi.x, hi.y));
    // the opening is pure black in the still, so the hole follows the real
    // frame edge (and leaves the plant alone) instead of a hard rectangle
    float luma = dot(texture2D(uTex, vUv).rgb, vec3(0.299, 0.587, 0.114));
    float hole = smoothstep(0.0, uFeather, inside) * (1.0 - smoothstep(0.035, 0.1, luma));

    gl_FragColor = vec4(wall.rgb, (1.0 - hole) * uOpacity);
  }
`;

export type FacadeMaterial = THREE.ShaderMaterial;

export function createFacadeMaterial(tex: THREE.Texture, rect: { x: number; y: number; w: number; h: number }): FacadeMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTex: { value: tex },
      uShadow: { value: tex },
      uHasShadow: { value: 0 },
      uShadowAmount: { value: 0.35 },
      uWindow: { value: new THREE.Vector4(rect.x, rect.y, rect.w, rect.h) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uFeather: { value: 2 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
  });
}
