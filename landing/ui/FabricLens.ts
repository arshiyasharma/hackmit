import type * as THREE from "three";
import { manifest } from "../data/manifest";
import { loadTexture } from "../gl/placeholder";
import { ease, gsap } from "../motion";
import { store } from "../state/store";
import { h } from "./dom";
import { Tile } from "./Tile";
import type { Interaction } from "./types";

// Fabric lens (spec A14, M6): a soft lens around the cursor shows the NEXT
// fabric of the whole close-up and drags a short smeared trail. A click grows
// the lens into a feathered wipe (C4 fabric wipe), then the lens previews the
// fabric after that. Four fabrics loop; after all four, Pick this one appears.

const RADIUS = 90;
const FEATHER = 60;
// trail point i chases point i - 1: per-frame lerp at 60fps, and its radius in px
const LAG = [1, 0.25, 0.2, 0.16, 0.13, 0.1];
const RADII = [RADIUS, 84, 76, 66, 56, 46];
// a finger that travelled less than this between down and up meant to tap
const TAP = 12;

export const runFabricLens: Interaction = async (ctx) => {
  const { stage, cursor } = ctx;
  const flat = stage.flat;
  const u = flat.uniforms;
  const fabrics = manifest.fabrics;
  const s = manifest.strings.lens;
  const offs: (() => void)[] = [];
  // there is no cursor on a phone: the lens has to ride the finger, and the
  // ring cursor would sit dead centre of the lens hiding the fabric it previews
  const coarse = window.matchMedia("(hover: none)").matches;

  const root = h("div", "lens-root");
  const hit = h("button", "lens-hit");
  hit.type = "button";
  hit.setAttribute("aria-label", "Show the next fabric");
  const dock = h("div", "lens-dock");
  const caption = h("p", "lens-caption", `<span class="lens-dot"></span><span class="lens-name"></span><span class="lens-count"></span>`);
  caption.setAttribute("role", "status");
  dock.appendChild(caption);
  root.append(hit, dock);
  ctx.ui.appendChild(root);

  const back = new Tile(root, { icon: "back", aria: "Back to the room", rest: -4, from: "left", className: "hud-back" });
  const pick = new Tile(dock, { icon: "check", label: s.tile, aria: s.tile, rest: -1.5, from: "bottom", className: "lens-pick" });
  const dot = caption.querySelector<HTMLElement>(".lens-dot")!;
  const name = caption.querySelector<HTMLElement>(".lens-name")!;
  const count = caption.querySelector<HTMLElement>(".lens-count")!;
  gsap.set(caption, { yPercent: 60, opacity: 0, rotation: 1.5 });

  // warm the texture cache so setB never stalls a wipe
  for (const f of fabrics) void loadTexture(f.still);
  await ctx.enterFlat(fabrics[0].still, fabrics[1].still);

  let settle!: (earned: boolean) => void;
  const result = new Promise<boolean>((resolve) => { settle = resolve; });
  let index = 0; // the fabric shown as still A
  let busy = false;
  let leaving = false;
  let over = false;
  const seen = new Set<number>([0]);
  const lens = { k: 0 }; // 0 to 1, scales the lens in and out
  const trail = u.uTrail.value as THREE.Vector3[];

  const label = (animate: boolean) => {
    const f = fabrics[index];
    name.textContent = f.name;
    // the ring cursor counts the fabrics off on a mouse; on touch it is hidden,
    // so the caption has to say how many are left
    if (coarse) count.textContent = `${seen.size} / ${fabrics.length}`;
    pick.el.setAttribute("aria-label", `${s.tile}: ${f.name}`);
    gsap.to(dot, { backgroundColor: f.color, duration: 0.5, ease: ease.out });
    if (animate) gsap.fromTo(name, { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: ease.out });
  };

  const finish = (earned: boolean) => {
    if (over) return;
    over = true;
    offs.forEach((off) => off());
    gsap.killTweensOf([lens, u.uReveal.value, u.uFeather, u.uMix, caption, dot, name]);
    flat.clearTrail();
    u.uFeather.value = FEATHER;
    if (earned) u.uReveal.value.z = 0;
    cursor.hide();
    void ctx.toast.hide();
    back.destroy();
    pick.destroy();
    root.remove();
    settle(earned);
  };

  // ---- the lens follows the pointer, the trail lags behind it ----
  // A mouse hands it the smoothed cursor every frame. A finger only exists
  // while it is down, so touch keeps the last place it put the lens, and the
  // lens opens in the middle of the frame rather than parked at 0, 0.
  const aim = { x: 0, y: 0, placed: false };
  const aimAt = (x: number, y: number) => { aim.x = x; aim.y = y; aim.placed = true; };

  let primed = false;
  offs.push(stage.onFrame((dt) => {
    if (over) return;
    if (!coarse && (cursor.x || cursor.y)) aimAt(cursor.x, cursor.y);
    else if (!aim.placed) { aim.x = (flat.W || window.innerWidth) / 2; aim.y = (flat.H || window.innerHeight) / 2; }
    const at = flat.unproject(aim.x, aim.y);
    if (!primed) { for (const t of trail) t.set(at.u, at.v, 0); primed = true; }
    const points = stage.reduced ? 1 : trail.length;
    for (let i = 0; i < trail.length; i++) {
      const t = trail[i];
      if (i >= points) { t.z = 0; continue; }
      const to = i === 0 ? at : { u: trail[i - 1].x, v: trail[i - 1].y };
      const k = 1 - Math.pow(1 - LAG[i], dt * 60);
      t.x += (to.u - t.x) * k;
      t.y += (to.v - t.y) * k;
      t.z = RADII[i] * lens.k;
    }
  }));

  // ---- a click grows the lens into the fabric wipe (C4) ----
  const wipe = async (x: number, y: number) => {
    if (busy || over) return;
    busy = true;
    void ctx.toast.hide();
    const at = flat.unproject(x, y);
    if (stage.reduced) {
      await gsap.to(u.uMix, { value: 1, duration: 0.4, ease: ease.out });
    } else {
      u.uReveal.value.set(at.u, at.v, RADIUS);
      gsap.to(u.uFeather, { value: 200, duration: 0.9, ease: ease.slide });
      await gsap.to(u.uReveal.value, { z: flat.diagonal * 1.5, duration: 0.9, ease: ease.slide });
    }
    if (over) return;
    flat.commit(); // B becomes A, so the lens shows nothing new until the next B lands
    u.uFeather.value = FEATHER;
    index = (index + 1) % fabrics.length;
    const first = seen.size === 1;
    seen.add(index);
    if (!coarse) cursor.progress = seen.size / fabrics.length;
    label(!first);
    if (first) gsap.to(caption, { yPercent: 0, opacity: 1, duration: 0.6, delay: 0.3, ease: ease.pop });
    if (seen.size === fabrics.length && !pick.shown) pick.show(0.1);
    await flat.setB(fabrics[(index + 1) % fabrics.length].still);
    busy = false;
  };

  let held: { id: number; x: number; y: number } | null = null;
  let pointerAt = 0;
  const onDown = (e: PointerEvent) => {
    pointerAt = performance.now();
    if (e.pointerType === "mouse") {
      if (e.button === 0) void wipe(e.clientX, e.clientY);
      return;
    }
    // touch and pen: the finger places the lens at once, and only a tap spends
    // a fabric, so a drag can carry the lens around the sofa first
    held = { id: e.pointerId, x: e.clientX, y: e.clientY };
    aimAt(e.clientX, e.clientY);
    try { hit.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  };
  const onMove = (e: PointerEvent) => {
    if (held && e.pointerId === held.id) aimAt(e.clientX, e.clientY);
  };
  const onUp = (e: PointerEvent) => {
    if (!held || e.pointerId !== held.id) return;
    const tap = Math.hypot(e.clientX - held.x, e.clientY - held.y) < TAP;
    held = null;
    aimAt(e.clientX, e.clientY);
    if (tap) void wipe(e.clientX, e.clientY);
  };
  const onCancel = () => { held = null; };
  // keyboard activation arrives as a click with no pointer behind it, and a tap
  // sends one of those along a beat later, so recent pointers disqualify it
  const onClick = (e: MouseEvent) => {
    if (e.detail === 0 && performance.now() - pointerAt > 700) void wipe(aim.x, aim.y);
  };
  hit.addEventListener("pointerdown", onDown);
  hit.addEventListener("pointermove", onMove);
  hit.addEventListener("pointerup", onUp);
  hit.addEventListener("pointercancel", onCancel);
  hit.addEventListener("click", onClick);

  const leave = (earned: boolean) => {
    if (busy || leaving || over) return;
    leaving = busy = true;
    if (earned) store.set({ fabric: fabrics[index].id });
    back.hide();
    pick.hide();
    gsap.to(caption, { yPercent: 60, opacity: 0, duration: 0.25, ease: ease.out });
    gsap.to(lens, { k: 0, duration: 0.25, ease: ease.out, onComplete: () => finish(earned) });
  };
  back.onClick(() => {
    if (over || leaving) return;
    // backing out mid-wipe is allowed: the plane fades with the wipe frozen where it was
    if (busy) { finish(false); return; }
    leave(false);
  });
  pick.onClick(() => leave(true));

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || over || leaving) return;
    if (busy) finish(false); else leave(false);
  };
  window.addEventListener("keydown", onKey);
  offs.push(() => window.removeEventListener("keydown", onKey));

  label(false);
  if (!coarse) { cursor.show("swatch"); cursor.progress = seen.size / fabrics.length; }
  // nobody clicks anything on a phone
  void ctx.toast.show("hand", coarse ? s.toast.map((l) => l.replace("Click", "Tap")) : s.toast);
  back.show();
  hit.focus({ preventScroll: true }); // Space or Enter runs the wipe for keyboard shoppers
  gsap.to(lens, { k: 1, duration: 0.6, ease: ease.out });

  return result;
};
