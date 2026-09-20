import * as THREE from "three";
import { manifest, type ChapterIndex } from "../data/manifest";
import { gsap } from "../motion";
import { createFacadeMaterial, type FacadeMaterial } from "./materials/facade";
import { createRoomMaterial, type RoomMaterial } from "./materials/room";
import { loadTexture } from "./placeholder";

// The dollhouse. A rig group takes the damped mouse roll and travel (spec C4);
// inside it the world group holds a strip of three facade modules, each with
// its room plane parented exactly into the window rect. A camera pose is a
// scale plus a focus point on the strip, so flying through a window needs no cut.

export interface Pose { scale: number; fx: number; fy: number }

interface Module {
  group: THREE.Group;
  facade: THREE.Mesh<THREE.PlaneGeometry, FacadeMaterial>;
  room: THREE.Mesh<THREE.PlaneGeometry, RoomMaterial>;
  still: string;
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

// half the hotspot hit area (93px in components.css): no framing may push a
// hotspot closer than this to a screen edge, or it cannot be tapped
const SPOT_MARGIN = 46;
// a touch drag is direct manipulation, so it cannot lag a third of a second
// behind the finger the way the mouse rig is allowed to
const DRAG_DAMPING = 0.2;

export class World {
  rig = new THREE.Group();
  world = new THREE.Group();
  strip = new THREE.Group();
  modules: Module[] = [];

  W = 1; H = 1;
  mW = 1; mH = 1;
  winW = 1; winH = 1; winCy = 0;
  insideScale = 1;
  portrait = 0;      // 0 on a 16:9 screen, 1 on a phone held upright
  dragging = false;  // a finger is on the stage, so the rig follows it directly

  pose: Pose = { scale: 1, fx: 0, fy: 0 };
  target = { x: 0, y: 0 };
  current = { x: 0, y: 0 };
  rigAmount = 1;
  extraRollDeg = 0;
  reduced = false;
  lastInput = 0;

  // live values read by project()
  roll = 0;
  travel = { x: 0, y: 0 };

  private disposed = false;
  private geometry?: THREE.PlaneGeometry;
  private wide = { tx: 0, ty: 0, rollScale: 1 };

  constructor() {
    this.rig.add(this.world);
    this.world.add(this.strip);
  }

  async build(stills: string[]) {
    if (this.disposed) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geometry = geo;
    for (const chapter of manifest.chapters) {
      const [facadeTex, roomTex] = await Promise.all([loadTexture(chapter.facade), loadTexture(stills[chapter.index])]);
      if (this.disposed) return;
      const group = new THREE.Group();
      const room = new THREE.Mesh(geo, createRoomMaterial(roomTex));
      const facade = new THREE.Mesh(geo, createFacadeMaterial(facadeTex, manifest.windowRect));
      room.renderOrder = 1;
      facade.renderOrder = 2;
      group.add(room, facade);
      this.strip.add(group);
      this.modules.push({ group, facade, room, still: stills[chapter.index] });
    }
  }

  setShadowVideo(tex: THREE.Texture) {
    for (const m of this.modules) {
      m.facade.material.uniforms.uShadow.value = tex;
      m.facade.material.uniforms.uHasShadow.value = 1;
    }
  }

  layout(W: number, H: number) {
    const keepInside = this.pose.scale / this.insideScale;
    const chapter = this.chapterAtFocus();
    this.W = W; this.H = H;

    // How far the viewport sits below the aspect range the rig was drawn for
    // (manifest.portrait). Smoothed so a tablet or a half-width window eases
    // between the two framings instead of snapping.
    const q = manifest.portrait;
    this.portrait = smooth(clamp((q.from - W / H) / (q.from - q.until), 0, 1));

    // each 16:9 module covers the viewport times the facade cover factor; on a
    // phone held upright it covers the width only, so a module still reads as a
    // module instead of as a vertical slice of wall
    this.mH = manifest.facadeCover * Math.max(H * (1 - this.portrait), (W * 9) / 16);
    this.mW = (this.mH * 16) / 9;
    const r = manifest.windowRect;
    this.winW = r.w * this.mW;
    this.winH = r.h * this.mH;
    this.winCy = (0.5 - (r.y + r.h / 2)) * this.mH;
    const winCxOffset = (r.x + r.w / 2 - 0.5) * this.mW;

    // idle framing: the designed zoom on a cover fit, easing to a width fit that
    // shows the whole room and letterboxes onto the paper as the screen narrows
    const cover = Math.max(W / this.winW, H / this.winH);
    const widthFit = q.bleed * (W / this.winW);
    this.insideScale = gsap.utils.interpolate(manifest.idleZoom * cover, widthFit, this.portrait);
    // past 1.92 the designed zoom crops the width for nothing, because the extra
    // height is already there: take the closest framing that still hides every
    // edge with the rig at its extreme
    if (W / H > 1.92) this.insideScale = Math.min(this.insideScale, this.edgeSafeScale());
    // and never frame so close that a hotspot lands under a thumb's width of the
    // screen edge, whatever the aspect
    this.insideScale = Math.min(this.insideScale, this.spotSafeScale());

    this.modules.forEach((m, i) => {
      m.group.position.set(i * this.mW, 0, 0);
      m.facade.scale.set(this.mW, this.mH, 1);
      m.facade.material.uniforms.uSize.value.set(this.mW, this.mH);
      m.room.position.set(winCxOffset, this.winCy, 0);
      m.room.scale.set(this.winW, this.winH, 1);
    });

    // edge pan rule: widen travel when part of the safe area falls off screen
    const RW = this.insideScale * this.winW;
    const RH = this.insideScale * this.winH;
    const s = manifest.safeArea;
    const baseX = manifest.travelX * W;
    const baseY = manifest.travelY * H;
    const needX = ((s.u1 - s.u0) / 2) * RW - 0.42 * W;
    const needY = ((s.v1 - s.v0) / 2) * RH - 0.42 * H;
    const tx = clamp(Math.max(baseX, needX), 0, Math.max(0, (RW - W) / 2 - 2));
    const ty = clamp(Math.max(baseY, needY), 0, Math.max(0, (RH - H) / 2 - 2));
    const ratio = Math.min(baseX / Math.max(tx, 1e-3), baseY / Math.max(ty, 1e-3), 1);
    this.wide = { tx, ty, rollScale: Math.max(ratio, 0.35) };

    // keep the same framing across a resize
    const next = keepInside > 0.5 ? this.insidePose(chapter) : this.outsidePose(chapter);
    Object.assign(this.pose, next);
    this.apply();
  }

  /** The smallest idle scale that keeps every edge of the still hidden at full roll and travel. */
  private edgeSafeScale() {
    const roll = manifest.maxRollDeg * DEG;
    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    // the viewport corner, travel included, has to stay inside the rolled still
    const px = this.W / 2 + manifest.travelX * this.W;
    const py = this.H / 2 + manifest.travelY * this.H;
    return Math.max((px * cos + py * sin) / (this.winW / 2), (py * cos + px * sin) / (this.winH / 2));
  }

  /** The largest idle scale that keeps every hotspot a hit area inside the screen. */
  private spotSafeScale() {
    let du = 0;
    let dv = 0;
    for (const h of manifest.hotspots) {
      du = Math.max(du, Math.abs(h.u - 0.5));
      dv = Math.max(dv, Math.abs(h.v - 0.5));
    }
    const x = du > 0 ? (this.W / 2 - SPOT_MARGIN) / (du * this.winW) : Infinity;
    const y = dv > 0 ? (this.H / 2 - SPOT_MARGIN) / (dv * this.winH) : Infinity;
    return Math.max(0.01, Math.min(x, y));
  }

  // ---- poses -------------------------------------------------------------

  windowCenter(i: number) {
    const r = manifest.windowRect;
    return { x: i * this.mW + (r.x + r.w / 2 - 0.5) * this.mW, y: this.winCy };
  }

  outsidePose(i: number): Pose {
    const c = this.windowCenter(i);
    return { scale: 1, fx: c.x, fy: c.y };
  }

  insidePose(i: number): Pose {
    const c = this.windowCenter(i);
    return { scale: this.insideScale, fx: c.x, fy: c.y };
  }

  /** A pose zoomed past idle toward a uv point, clamped so the still covers the viewport. */
  pushPose(i: number, u: number, v: number, zoom: number, pull = 0.5): Pose {
    const c = this.windowCenter(i);
    const scale = this.insideScale * zoom;
    const hx = c.x + (u - 0.5) * this.winW;
    const hy = c.y + (0.5 - v) * this.winH;
    // the point currently sits d px from the screen center; pull brings it closer
    const dx = this.insideScale * (hx - c.x) * (1 - pull);
    const dy = this.insideScale * (hy - c.y) * (1 - pull);
    const maxX = Math.max(0, (scale * this.winW - this.W) / (2 * scale));
    const maxY = Math.max(0, (scale * this.winH - this.H) / (2 * scale));
    return {
      scale,
      fx: clamp(hx - dx / scale, c.x - maxX, c.x + maxX),
      fy: clamp(hy - dy / scale, c.y - maxY, c.y + maxY),
    };
  }

  introPose(): Pose {
    const f = manifest.introFocus;
    return this.pushPose(0, f.u, f.v, manifest.introZoom / manifest.idleZoom, 1);
  }

  chapterAtFocus(): ChapterIndex {
    return clamp(Math.round(this.pose.fx / Math.max(this.mW, 1)), 0, manifest.chapters.length - 1) as ChapterIndex;
  }

  /** 0 on the facade, 1 at the idle zoom inside a room. */
  get insideness() {
    if (this.insideScale <= 1) return 1;
    return clamp(Math.log(this.pose.scale) / Math.log(this.insideScale), 0, 1);
  }

  // ---- rig ---------------------------------------------------------------

  pointer(nx: number, ny: number) {
    this.target.x = clamp(nx, -1, 1);
    this.target.y = clamp(ny, -1, 1);
    this.lastInput = performance.now();
  }

  update(dt: number, time: number) {
    // slow idle sway when nothing drives the rig (touch devices, idle mouse)
    if (performance.now() - this.lastInput > 6000) {
      this.target.x = Math.sin(time * 0.35) * 0.22;
      this.target.y = Math.cos(time * 0.27) * 0.15;
    }
    const k = 1 - Math.pow(1 - (this.dragging ? DRAG_DAMPING : manifest.damping), dt * 60);
    this.current.x += (this.target.x - this.current.x) * k;
    this.current.y += (this.target.y - this.current.y) * k;
    this.apply();
    for (const m of this.modules) m.facade.material.uniforms.uTime.value = time;
  }

  apply() {
    const amount = this.reduced ? 0 : this.rigAmount;
    const inside = this.insideness;
    const tx = gsap.utils.interpolate(manifest.travelX * this.W, this.wide.tx, inside);
    const ty = gsap.utils.interpolate(manifest.travelY * this.H, this.wide.ty, inside);
    const rollScale = gsap.utils.interpolate(1, this.wide.rollScale, inside);

    // clockwise on screen when the mouse is on the right, so negative in three
    const rollDeg = clamp(this.current.x * manifest.maxRollDeg * rollScale * amount + this.extraRollDeg, -manifest.maxRollDeg, manifest.maxRollDeg);
    this.roll = -rollDeg * DEG;
    this.travel.x = -this.current.x * tx * amount;
    this.travel.y = this.current.y * ty * amount;

    this.rig.rotation.z = this.roll;
    this.rig.position.set(this.travel.x, this.travel.y, 0);
    this.world.scale.setScalar(this.pose.scale);
    this.world.position.set(-this.pose.scale * this.pose.fx, -this.pose.scale * this.pose.fy, 0);

    const px = this.current.x * manifest.parallax * amount;
    const py = this.current.y * manifest.parallax * amount;
    for (const m of this.modules) {
      const u = m.room.material.uniforms;
      u.uParallax.value.set(-px, py);
      u.uSize.value.set(this.winW * this.pose.scale, this.winH * this.pose.scale);
    }
  }

  // ---- projection --------------------------------------------------------

  /** Room uv (origin top left) of module i to CSS pixels, with the live scale, travel, and roll. */
  project(u: number, v: number, i: number) {
    const c = this.windowCenter(i);
    return this.projectStrip(c.x + (u - 0.5) * this.winW, c.y + (0.5 - v) * this.winH);
  }

  /** Module uv (origin top left) to CSS pixels, for labels attached to a facade. */
  projectModule(u: number, v: number, i: number) {
    return this.projectStrip(i * this.mW + (u - 0.5) * this.mW, (0.5 - v) * this.mH);
  }

  private projectStrip(lx: number, ly: number) {
    const s = this.pose.scale;
    const x = s * (lx - this.pose.fx);
    const y = s * (ly - this.pose.fy);
    const cos = Math.cos(this.roll);
    const sin = Math.sin(this.roll);
    return {
      x: this.W / 2 + (x * cos - y * sin) + this.travel.x,
      y: this.H / 2 - (x * sin + y * cos) - this.travel.y,
      rollDeg: -this.roll / DEG,
      scale: s,
    };
  }

  // ---- content -----------------------------------------------------------

  setFacadeOpacity(value: number) {
    for (const m of this.modules) {
      m.facade.material.uniforms.uOpacity.value = value;
      m.facade.visible = value > 0.001;
    }
  }

  get facadeOpacity() {
    return this.modules[0]?.facade.material.uniforms.uOpacity.value ?? 0;
  }

  /** Swap a chapter's room still, crossfading when it is on screen. */
  async setRoomStill(i: number, path: string, seconds = 0) {
    const m = this.modules[i];
    if (!m || m.still === path) return;
    m.still = path;
    const tex = await loadTexture(path);
    if (this.disposed) return;
    const u = m.room.material.uniforms;
    if (seconds <= 0) {
      u.uTexA.value = tex;
      u.uTexB.value = tex;
      return;
    }
    u.uTexB.value = tex;
    await new Promise<void>((resolve) =>
      gsap.to(u.uMix, { value: 1, duration: seconds, ease: "power2.inOut", onComplete: resolve }),
    );
    u.uTexA.value = tex;
    u.uMix.value = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.modules) {
      m.facade.material.dispose();
      m.room.material.dispose();
    }
    this.geometry?.dispose();
    this.modules = [];
    this.strip.clear();
  }
}
