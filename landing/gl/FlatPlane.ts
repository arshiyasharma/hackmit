import * as THREE from "three";
import { manifest } from "../data/manifest";
import { gsap } from "../motion";
import { createRoomMaterial, type RoomMaterial } from "./materials/room";
import { loadTexture } from "./placeholder";

// Interaction close-ups render flat (spec E1 item 6): one full-screen plane,
// cover fit at zoom 1.0, never tilted. DOM overlays are placed with
// projectFlat(), which uses the same cover-fit math.
//
// A phone held upright cover fits a 16:9 still to a quarter of its width, so a
// close-up also has to be framed on its subject: layout() takes a focus point
// and a zoom, and both fold into projectFlat() so every overlay follows.

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// ApproveInteraction draws the phone interface at 200px wide and scales it by
// the still's phone screen; under about 170px its labels drop below 11px
const PHONE_MIN = 170;
// a framed subject keeps this much screen edge around it
const EDGE = 16;

export class FlatPlane {
  mesh: THREE.Mesh<THREE.PlaneGeometry, RoomMaterial>;
  W = 1; H = 1;
  pw = 1; ph = 1;
  // subject framing, in image uv and a multiple of the cover fit
  focus = { u: 0.5, v: 0.5 };
  zoom = 1;
  // the pan that puts the focus on the screen center, in CSS px, screen axes
  dx = 0; dy = 0;
  private aspect = 16 / 9;
  // the still currently on screen: frame() reads the viewport, so a rotation or
  // a URL bar move has to re-ask it what the framing should be
  private path = "";

  constructor() {
    const blank = new THREE.Texture();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createRoomMaterial(blank));
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.uniforms.uOpacity.value = 0;
  }

  get uniforms() {
    return this.mesh.material.uniforms;
  }

  layout(W: number, H: number) {
    this.W = W; this.H = H;
    // how hard the cover fit crops depends on the viewport, so the framing is
    // re-derived on every resize rather than left at the value show() picked
    this.frame(this.path);
    this.ph = this.coverHeight() * this.zoom;
    this.pw = this.ph * this.aspect;
    // pan onto the focus point, clamped so the still keeps covering the screen
    this.dx = clamp((0.5 - this.focus.u) * this.pw, -(this.pw - W) / 2, (this.pw - W) / 2);
    this.dy = clamp((0.5 - this.focus.v) * this.ph, -(this.ph - H) / 2, (this.ph - H) / 2);
    this.mesh.position.set(this.dx, -this.dy, 0);
    this.mesh.scale.set(this.pw, this.ph, 1);
    this.uniforms.uSize.value.set(this.pw, this.ph);
  }

  /** Plane height at zoom 1: the cover fit of a 16:9 still. */
  private coverHeight() {
    return Math.max(this.W / this.aspect, this.H);
  }

  /** Image uv (origin top left) to CSS pixels. */
  projectFlat(u: number, v: number) {
    return { x: this.W / 2 + (u - 0.5) * this.pw + this.dx, y: this.H / 2 + (v - 0.5) * this.ph + this.dy };
  }

  /** CSS pixels to image uv, used by the lens to follow the pointer. */
  unproject(x: number, y: number) {
    return { u: (x - this.W / 2 - this.dx) / this.pw + 0.5, v: (y - this.H / 2 - this.dy) / this.ph + 0.5 };
  }

  /**
   * Frame a still on its subject. Centered and at zoom 1 this is the cover fit
   * the spec asks for, which is what every wide screen gets; a narrow or short
   * screen crops so hard that the subject has to be pulled back into frame.
   */
  private frame(path: string) {
    const r = manifest.phoneScreen;
    if (path === manifest.approve.up || path === manifest.approve.down) {
      // the phone is 12.7% of the still's width: a cover fit leaves it 108px
      // wide on a phone in landscape, far too small to read or to tap
      const cover = this.coverHeight();
      const w = r.w * cover * this.aspect;
      const h = r.h * cover;
      const rot = Math.abs(r.rot) * DEG;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      // ... but never zoom past the point where its tilted box leaves the screen
      const fits = Math.min((this.W - 2 * EDGE) / (w * cos + h * sin), (this.H - 2 * EDGE) / (h * cos + w * sin));
      this.zoom = clamp(PHONE_MIN / w, 1, Math.max(1, fits));
      this.focus = { u: r.cx, v: r.cy };
      return;
    }
    // A1a and A1b put the reading corner at u 0.305, and a phone held upright
    // only shows u 0.37 to 0.63 of the still: pan to the corner, do not crop it
    const corner = path === manifest.rooms.A1a || path === manifest.rooms.A1b;
    this.zoom = 1;
    this.focus = { u: corner ? manifest.lampBase.u : 0.5, v: 0.5 };
  }

  async show(pathA: string, pathB = pathA, seconds = 0.6) {
    // B always shares A's framing branch (the approve pair, the A1 pair, or the
    // centred default), so the base still is enough to decide it
    this.path = pathA;
    this.layout(this.W, this.H);
    const [a, b] = await Promise.all([loadTexture(pathA), loadTexture(pathB)]);
    const u = this.uniforms;
    u.uTexA.value = a;
    u.uTexB.value = b;
    u.uMix.value = 0;
    u.uReveal.value.set(0.5, 0.5, 0);
    this.clearTrail();
    this.mesh.visible = true;
    await new Promise<void>((resolve) => gsap.to(u.uOpacity, { value: 1, duration: seconds, ease: "power2.inOut", onComplete: resolve }));
  }

  async hide(seconds = 0.6) {
    await new Promise<void>((resolve) => gsap.to(this.uniforms.uOpacity, { value: 0, duration: seconds, ease: "power2.inOut", onComplete: resolve }));
    this.mesh.visible = false;
  }

  async setB(path: string) {
    this.uniforms.uTexB.value = await loadTexture(path);
  }

  /** Make still B the base after a wipe has covered the screen. */
  commit() {
    const u = this.uniforms;
    u.uTexA.value = u.uTexB.value;
    u.uMix.value = 0;
    u.uReveal.value.z = 0;
  }

  clearTrail() {
    for (const t of this.uniforms.uTrail.value as THREE.Vector3[]) t.set(0.5, 0.5, 0);
  }

  get diagonal() {
    return Math.hypot(this.W, this.H);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
