import * as THREE from "three";
import { asset, manifest, type ChapterIndex } from "../data/manifest";
import { done, ease, gsap, reducedMotion, T } from "../motion";
import { store } from "../state/store";
import { FlatPlane } from "./FlatPlane";
import { exists } from "./placeholder";
import { PostFX } from "./PostFX";
import { World, type Pose } from "./World";

// One fixed full-screen canvas, an orthographic camera where world units equal
// CSS pixels, one requestAnimationFrame loop (spec E1 items 1, 2, 5).

type FrameFn = (dt: number, time: number) => void;

// the paper the stage sits on: a phone held upright letterboxes the 16:9 stills,
// and the bands read as the page rather than as a black bar (tokens --paper-page)
const PAPER = 0xefe8cf;
// a phone runs three full screen passes a frame. At dpr 3 that is nine times the
// pixels of a dpr 1 pass for a screen you hold at arm's length: it only heats the
// device up and drops the frame rate.
const DPR_CAP = { fine: 1.6, coarse: 1.3 };

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  world = new World();
  flat = new FlatPlane();
  post: PostFX;
  W = 1; H = 1;
  reduced = reducedMotion();

  private frames = new Set<FrameFn>();
  private raf = 0;
  private last = 0;
  private paused = false;
  private coarse = window.matchMedia("(pointer: coarse)").matches;
  private dprCap = this.coarse ? DPR_CAP.coarse : DPR_CAP.fine;
  private sized = "";
  private shadowVideo?: HTMLVideoElement;
  private cleanup: (() => void)[] = [];

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(PAPER, 1);
    this.renderer.autoClear = false;
    this.post = new PostFX(this.renderer);
    this.post.lowQuality = this.coarse;
    this.scene.add(this.world.rig, this.flat.mesh);
    this.world.reduced = this.reduced;
  }

  async init() {
    await this.world.build(manifest.chapters.map((c) => store.roomStill(c.index)));
    this.resize();

    const onResize = () => this.resize();
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      this.world.pointer((e.clientX / this.W) * 2 - 1, (e.clientY / this.H) * 2 - 1);
    };
    // on touch a drag pans the room inside the same clamp as the mouse rig
    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    const onDown = (e: PointerEvent) => {
      // while the product covers the stage every touch on the page is the product's
      if (this.paused || e.pointerType !== "touch") return;
      drag = { x: e.clientX, y: e.clientY, tx: this.world.target.x, ty: this.world.target.y };
      this.world.dragging = true;
    };
    const onDrag = (e: PointerEvent) => {
      if (!drag || e.pointerType !== "touch") return;
      this.world.pointer(drag.tx - ((e.clientX - drag.x) / this.W) * 2.5, drag.ty - ((e.clientY - drag.y) / this.H) * 2.5);
    };
    const onUp = () => { drag = null; this.world.dragging = false; };
    // touch devices: a gentle device-orientation tilt when permission is granted,
    // otherwise the world keeps its slow idle sway (spec E1 quality bars)
    let base: { g: number; b: number } | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (drag || e.gamma == null || e.beta == null) return;
      base ??= { g: e.gamma, b: e.beta };
      const g = (e.gamma - base.g) / 25;
      const b = (e.beta - base.b) / 25;
      // gamma and beta are the device's own axes, so they swap when the phone is
      // turned sideways; without this the room tilts across the wrong axis
      const angle = window.screen?.orientation?.angle ?? 0;
      if (angle === 90) this.world.pointer(b, -g);
      else if (angle === 270) this.world.pointer(-b, g);
      else if (angle === 180) this.world.pointer(-g, -b);
      else this.world.pointer(g, b);
    };
    const askTilt = () => {
      // never raise the motion permission prompt on a tap that belongs to the
      // product (its first tap is "Continue with Google"); wait for one of ours
      if (this.paused) return;
      window.removeEventListener("pointerup", askTilt);
      if (!window.matchMedia("(pointer: coarse)").matches || typeof DeviceOrientationEvent === "undefined") return;
      const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
      const listen = () => window.addEventListener("deviceorientation", onTilt);
      if (ask) ask.call(DeviceOrientationEvent).then((r) => { if (r === "granted") listen(); }).catch(() => {});
      else listen();
    };
    window.addEventListener("pointerup", askTilt);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => { this.reduced = motion.matches; this.world.reduced = motion.matches; };

    // the URL bar sliding away, the keyboard, a rotation: on a phone the canvas
    // is resized by things that never fire a window resize, so watch the element
    const observer = new ResizeObserver(onResize);
    observer.observe(this.canvas.parentElement!);
    // rotating changes what "flat on the table" means, so take a fresh neutral
    const onTurn = () => { base = null; onResize(); };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onTurn);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    motion.addEventListener("change", onMotion);
    this.cleanup.push(() => {
      observer.disconnect();
      window.removeEventListener("orientationchange", onTurn);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onDrag);
      window.removeEventListener("pointerup", onUp);
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("pointerup", askTilt);
      window.removeEventListener("deviceorientation", onTilt);
    });

    void this.loadShadowLoop();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private async loadShadowLoop() {
    if (!(await exists(manifest.video.shadow))) return;
    const video = document.createElement("video");
    video.src = asset(manifest.video.shadow);
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    try {
      await video.play();
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.NoColorSpace;
      this.shadowVideo = video;
      this.world.setShadowVideo(tex);
    } catch {
      // autoplay refused: the procedural shadow stays
    }
  }

  setQuality(low: boolean) {
    const cap = this.coarse ? DPR_CAP.coarse : DPR_CAP.fine;
    this.dprCap = low ? cap * 0.8 : cap;
    this.post.lowQuality = low || this.coarse;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement!;
    this.W = parent.clientWidth || window.innerWidth;
    this.H = parent.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    // iOS fires resize through every frame of the URL bar sliding away, and each
    // one would reallocate three full screen render targets
    const key = `${this.W}|${this.H}|${dpr}`;
    if (key === this.sized) return;
    this.sized = key;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.W, this.H, false);
    this.camera.left = -this.W / 2;
    this.camera.right = this.W / 2;
    this.camera.top = this.H / 2;
    this.camera.bottom = -this.H / 2;
    this.camera.updateProjectionMatrix();
    this.post.resize(this.W, this.H, dpr);
    this.world.layout(this.W, this.H);
    this.flat.layout(this.W, this.H);
  }

  onFrame(fn: FrameFn) {
    this.frames.add(fn);
    return () => this.frames.delete(fn);
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // fully covered by the product: keep the clock, skip the draw
    if (!this.paused) this.frame(dt, now / 1000);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Stop drawing while something opaque covers the stage. The product runs a
   *  camera and its own WebGL scene, and a phone will not pay for two. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.last = performance.now();
  }

  frame(dt: number, time: number) {
    this.world.update(dt, time);
    this.frames.forEach((fn) => fn(dt, time));
    this.post.render(this.scene, this.camera, time);
  }

  // ---- camera moves (spec C4) -------------------------------------------

  /** Tween the pose. Scale moves geometrically so a zoom reads as constant speed. */
  tweenPose(to: Pose, duration: number, easing: gsap.EaseFunction | string = ease.slide) {
    const from = { ...this.world.pose };
    const state = { t: 0 };
    return gsap.to(state, {
      t: 1,
      duration,
      ease: easing,
      onUpdate: () => {
        this.world.pose.scale = from.scale * Math.pow(to.scale / from.scale, state.t);
        this.world.pose.fx = from.fx + (to.fx - from.fx) * state.t;
        this.world.pose.fy = from.fy + (to.fy - from.fy) * state.t;
      },
    });
  }

  setPose(to: Pose) {
    Object.assign(this.world.pose, to);
    this.world.apply();
  }

  /** Reduced motion: every camera move becomes a 0.4s crossfade. */
  async crossfadeTo(change: () => void) {
    this.post.snapshot(this.scene, this.camera, performance.now() / 1000);
    this.post.values.freeze = 1;
    change();
    this.world.apply();
    await done(gsap.to(this.post.values, { freeze: 0, duration: 0.4, ease: "none" }));
  }

  private bump(key: "zoom" | "horizontal", duration: number, peakAt: number, peak = 1) {
    const v = this.post.values;
    const up: gsap.TweenVars = { duration: duration * peakAt, ease: "power2.in" };
    const down: gsap.TweenVars = { duration: duration * (1 - peakAt), ease: "power2.out" };
    up[key] = peak;
    down[key] = 0;
    return gsap.timeline().to(v, up).to(v, down);
  }

  async flyOut(i: ChapterIndex) {
    const world = this.world;
    if (this.reduced) {
      return this.crossfadeTo(() => { world.setFacadeOpacity(1); Object.assign(world.pose, world.outsidePose(i)); });
    }
    this.post.focusPoint.set(0.5, 0.5);
    const fade = { v: world.facadeOpacity };
    gsap.to(fade, { v: 1, duration: 0.15, ease: "none", onUpdate: () => world.setFacadeOpacity(fade.v) });
    this.bump("zoom", 2.4, 0.45);
    await done(this.tweenPose(world.outsidePose(i), 2.0));
  }

  async truck(to: ChapterIndex) {
    const world = this.world;
    if (this.reduced) return this.crossfadeTo(() => Object.assign(world.pose, world.outsidePose(to)));
    this.bump("horizontal", T.truck, 0.5);
    await done(this.tweenPose(world.outsidePose(to), T.truck));
  }

  async flyIn(i: ChapterIndex) {
    const world = this.world;
    if (this.reduced) {
      return this.crossfadeTo(() => { world.setFacadeOpacity(0); Object.assign(world.pose, world.insidePose(i)); });
    }
    this.post.focusPoint.set(0.5, 0.5);
    // anticipation: a small counter roll and a breath back before the dive
    const out = world.outsidePose(i);
    const side = world.current.x >= 0 ? -1 : 1;
    gsap.to(world, { extraRollDeg: 3 * side, duration: 0.3, ease: "power2.out" });
    await done(this.tweenPose({ ...out, scale: 0.98 }, 0.3, "power2.out"));

    gsap.to(world, { extraRollDeg: 0, duration: 1.0, ease: "power2.inOut" });
    this.bump("zoom", 1.4, 0.55);
    await done(this.tweenPose(world.insidePose(i), 1.4, ease.slide));

    const fade = { v: 1 };
    gsap.to(fade, { v: 0, duration: 0.15, ease: "none", onUpdate: () => world.setFacadeOpacity(fade.v) });
    this.post.values.horizontal = 0.22;
    await done(gsap.to(this.post.values, { horizontal: 0, duration: 0.5, ease: "power2.out" }));
  }

  /** Found reveal and viewer push: rig to 0, push toward a point, blur and veil up. */
  async pushIn(i: ChapterIndex, u: number, v: number) {
    const world = this.world;
    gsap.to(world, { rigAmount: 0, duration: 0.4, ease: "power2.out" });
    gsap.to(this.post.values, { focus: 1, veil: 1, duration: 0.8, ease: "power2.out" });
    if (this.reduced) return;
    await done(this.tweenPose(world.pushPose(i, u, v, 1.25), 1.2, ease.expo));
  }

  /** Pull back to the idle pose while the blur clears like a focus pull. */
  async pullBack(i: ChapterIndex, duration = 1.0) {
    const world = this.world;
    gsap.to(this.post.values, { focus: 0, veil: 0, duration, ease: "power2.inOut" });
    gsap.to(world, { rigAmount: 1, duration: duration + 0.4, ease: "power2.inOut" });
    if (this.reduced) { this.setPose(world.insidePose(i)); return; }
    await done(this.tweenPose(world.insidePose(i), duration, ease.out));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((fn) => fn());
    this.frames.clear();
    this.shadowVideo?.pause();
    gsap.killTweensOf(this.post.values);
    gsap.killTweensOf(this.world);
    this.world.dispose();
    this.flat.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
