import * as THREE from "three";

// Room and close-up material (spec E1 item 7). Mixes still A and still B by a
// feathered circular reveal plus a lagging lens trail, with optional depth
// parallax. uSize is the plane's size in CSS pixels so the reveal is a true
// circle measured in pixels.

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
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform sampler2D uDepth;
  uniform float uHasDepth;
  uniform vec2 uParallax;
  uniform vec3 uReveal;     // center uv (origin top left) and radius in px
  uniform float uFeather;   // px
  uniform vec3 uTrail[6];   // lens trail: uv and radius in px
  uniform float uMix;       // plain crossfade A to B
  uniform float uOpacity;
  uniform vec2 uSize;

  float disc(vec2 uv, vec3 c, float feather) {
    if (c.z <= 0.0) return 0.0;
    vec2 d = (uv - vec2(c.x, 1.0 - c.y)) * uSize;
    return 1.0 - smoothstep(c.z - feather, c.z, length(d));
  }

  void main() {
    vec2 uv = vUv;
    if (uHasDepth > 0.5) {
      float depth = texture2D(uDepth, uv).r;
      uv += (depth - 0.5) * uParallax;
    }
    vec4 a = texture2D(uTexA, uv);
    vec4 b = texture2D(uTexB, uv);
    float m = disc(vUv, uReveal, uFeather);
    for (int i = 0; i < 6; i++) {
      m = max(m, disc(vUv, uTrail[i], uFeather) * (1.0 - float(i) * 0.12));
    }
    m = max(m, uMix);
    gl_FragColor = vec4(mix(a.rgb, b.rgb, clamp(m, 0.0, 1.0)), uOpacity);
  }
`;

export type RoomMaterial = THREE.ShaderMaterial;

export function createRoomMaterial(tex: THREE.Texture): RoomMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTexA: { value: tex },
      uTexB: { value: tex },
      uDepth: { value: tex },
      uHasDepth: { value: 0 },
      uParallax: { value: new THREE.Vector2() },
      uReveal: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uFeather: { value: 60 },
      uTrail: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.5, 0.5, 0)) },
      uMix: { value: 0 },
      uOpacity: { value: 1 },
      uSize: { value: new THREE.Vector2(1, 1) },
    },
  });
}
