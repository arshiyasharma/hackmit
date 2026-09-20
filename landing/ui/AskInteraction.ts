import { manifest } from "../data/manifest";
import { ease, gsap } from "../motion";
import { h } from "./dom";
import { Tile } from "./Tile";
import type { Interaction } from "./types";

// ASK interaction (spec A12, M6): a handwritten note over the A1a close-up and
// a Hold to ask tile. The hold is a 1.2s timer, never the microphone. When it
// completes, A1b wipes in from the lamp base while dimension lines draw.

const HOLD = 1.2;
const DRAIN = HOLD / 2;
// where the dimension line stands on A1a: beside the lamp, arc top to base
const LAMP = { u: 0.24, top: 0.3, base: 0.82 };
const TICK = 8;
// how far the gauge keeps off the frame edge: its ticks plus a little air
const EDGE = TICK + 26;

export const runAsk: Interaction = async (ctx) => {
  const { stage, cursor } = ctx;
  const flat = stage.flat;
  const u = flat.uniforms;
  const s = manifest.strings.ask;
  const offs: (() => void)[] = [];
  // a phone has no cursor for the ring to ride, and one drawn under the thumb
  // would cover the tile it is reporting on, so the tile fills instead
  const coarse = window.matchMedia("(hover: none)").matches;

  const root = h("div", `ask-root${coarse ? " ask-touch" : ""}`);
  const dim = h("div", "ask-dim", `
    <svg aria-hidden="true" focusable="false">
      <path class="ask-dim-line" pathLength="1"/><path class="ask-dim-tick" pathLength="1"/><path class="ask-dim-tick" pathLength="1"/>
    </svg>`);
  const chip = h("p", "ask-chip", s.dimension);
  dim.appendChild(chip);
  const dock = h("div", "ask-dock");
  const note = h("div", "ask-note", `<span class="ask-note-text">${s.note}</span>`);
  // env() only has a used value on a real box, so a zero-size probe is what
  // carries the notch and the home bar into the gauge maths below
  const probe = h("span", "safe-probe");
  root.append(dim, dock, probe);
  ctx.ui.appendChild(root);

  const back = new Tile(root, { icon: "back", aria: "Back to the room", rest: -4, from: "left", className: "hud-back" });
  const hold = new Tile(dock, { icon: "mic", label: s.tile, aria: `${s.tile}. Press and hold for about a second`, rest: 1.5, from: "bottom", className: "ask-hold" });
  const fill = h("span", "ask-fill");
  hold.el.appendChild(fill);
  dock.appendChild(note);

  const [line, tickTop, tickBase] = Array.from(dim.querySelectorAll<SVGPathElement>("path"));
  const strokes = [line, tickTop, tickBase];
  gsap.set(strokes, { strokeDasharray: 1, strokeDashoffset: 1, opacity: 0 });
  gsap.set(chip, { rotation: -3, scale: 0.6, opacity: 0 });
  gsap.set(note, { yPercent: 150, rotation: -2.5 });

  await ctx.enterFlat(manifest.rooms.A1a, manifest.rooms.A1b);

  let settle!: (earned: boolean) => void;
  const result = new Promise<boolean>((resolve) => { settle = resolve; });
  let phase: "hold" | "reveal" | "leaving" | "done" = "hold";

  const finish = (earned: boolean) => {
    if (phase === "done") return;
    phase = "done";
    offs.forEach((off) => off());
    gsap.killTweensOf([note, chip, dim, ...strokes]);
    cursor.hide();
    void ctx.toast.hide();
    back.destroy();
    hold.destroy();
    root.remove();
    settle(earned);
  };

  // keep the dimension line on the lamp through resizes (same cover-fit math as the plane)
  let placed = "";
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  offs.push(stage.onFrame(() => {
    const key = `${flat.W}|${flat.H}|${flat.pw}`;
    if (key === placed) return;
    placed = key;
    const box = getComputedStyle(probe);
    const safeL = parseFloat(box.paddingLeft) || 0;
    const safeR = parseFloat(box.paddingRight) || 0;
    const a = flat.projectFlat(LAMP.u, LAMP.top);
    const b = flat.projectFlat(LAMP.u, LAMP.base);
    // the plane is cover fit, so a 16:9 still keeps only its middle third on a
    // portrait phone: u 0.24 projects to about -120px on a 375 wide screen and
    // the whole gauge would be lost. Pin it inside the frame instead.
    const x = clamp(a.x, safeL + EDGE, flat.W - safeR - EDGE);
    const top = clamp(a.y, 24, flat.H - 24);
    const base = clamp(b.y, 24, flat.H - 24);
    const mid = (top + base) / 2;
    // a slight bow so the line reads as drawn by hand
    line.setAttribute("d", `M${x.toFixed(1)} ${top.toFixed(1)}Q${(x - 2.5).toFixed(1)} ${mid.toFixed(1)} ${x.toFixed(1)} ${base.toFixed(1)}`);
    tickTop.setAttribute("d", `M${(x - TICK).toFixed(1)} ${(top + 1).toFixed(1)}L${(x + TICK).toFixed(1)} ${(top - 1).toFixed(1)}`);
    tickBase.setAttribute("d", `M${(x - TICK).toFixed(1)} ${(base - 1).toFixed(1)}L${(x + TICK).toFixed(1)} ${(base + 1).toFixed(1)}`);
    // the chip sits left of the line, and flips to its right when the line has
    // been pinned to the left edge and there is no room left over there
    const w = chip.offsetWidth;
    const ch = chip.offsetHeight;
    const beside = x - 14 - w;
    const cx = beside >= safeL + 12 ? beside : clamp(x + 18, safeL + 12, flat.W - safeR - 12 - w);
    gsap.set(chip, { x: cx, y: clamp(mid - ch / 2, 12, flat.H - 12 - ch) });
  }));

  // ---- the hold: a timer that fills the cursor ring, never the microphone ----
  let pointerHeld = false;
  let keyHeld = false;
  let progress = 0;

  const paint = () => {
    if (!coarse) cursor.progress = progress;
    fill.style.transform = `scaleX(${progress.toFixed(3)})`;
    // on touch the same number washes across the tile face, since there is no
    // ring cursor to read and the 3px bar alone is too quiet under a thumb
    if (coarse) hold.el.style.setProperty("--hold", progress.toFixed(3));
    hold.el.classList.toggle("ask-holding", pointerHeld || keyHeld);
  };

  const reveal = async () => {
    phase = "reveal";
    pointerHeld = keyHeld = false;
    stopHold();
    cursor.hide();
    back.hide();
    hold.hide();
    gsap.to(note, { yPercent: 150, duration: 0.5, ease: ease.exit });

    const reduced = stage.reduced;
    gsap.set(strokes, { opacity: 1 });
    gsap.to(line, { strokeDashoffset: 0, duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.5, ease: ease.slide });
    gsap.to([tickTop, tickBase], { strokeDashoffset: 0, duration: reduced ? 0 : 0.3, delay: reduced ? 0 : 1.2, stagger: reduced ? 0 : 0.12, ease: ease.out });
    gsap.to(chip, { scale: 1, opacity: 1, duration: reduced ? 0.4 : 0.6, delay: reduced ? 0 : 1.3, ease: reduced ? ease.out : ease.pop });

    if (reduced) {
      await gsap.to(u.uMix, { value: 1, duration: 0.4, ease: ease.out });
    } else {
      u.uFeather.value = 120;
      u.uReveal.value.set(manifest.lampBase.u, manifest.lampBase.v, 0);
      await gsap.to(u.uReveal.value, { z: flat.diagonal * 1.5, duration: 1.6, ease: ease.slide });
    }

    // nothing can leave during the reveal: back and Escape only work while holding
    await ctx.say(3);
    await gsap.to(dim, { opacity: 0, duration: 0.3, ease: ease.out });
    flat.commit();
    u.uFeather.value = 60;
    finish(true);
  };

  const stopHold = stage.onFrame((dt) => {
    if (phase !== "hold") return;
    const held = pointerHeld || keyHeld;
    if (!held && progress === 0) return;
    progress = Math.min(1, Math.max(0, progress + (held ? dt / HOLD : -dt / DRAIN)));
    paint();
    if (progress >= 1) void reveal();
  });
  offs.push(stopHold);

  const onDown = (e: PointerEvent) => {
    if (phase !== "hold" || (e.pointerType === "mouse" && e.button !== 0)) return;
    // a second of finger on one spot is exactly what iOS reads as a selection
    // or a callout, so the touch path claims the gesture outright
    if (e.pointerType !== "mouse") e.preventDefault();
    pointerHeld = true;
    try { hold.el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    paint();
  };
  const onUp = () => { pointerHeld = false; paint(); };
  const onMenu = (e: Event) => e.preventDefault(); // a long press must not open the context menu
  hold.el.addEventListener("pointerdown", onDown);
  hold.el.addEventListener("pointerup", onUp);
  hold.el.addEventListener("pointercancel", onUp);
  hold.el.addEventListener("lostpointercapture", onUp);
  hold.el.addEventListener("contextmenu", onMenu);

  const goBack = () => {
    if (phase !== "hold") return;
    phase = "leaving";
    cursor.hide();
    back.hide();
    hold.hide();
    gsap.to(note, { yPercent: 150, duration: 0.3, ease: ease.out, onComplete: () => finish(false) });
  };
  back.onClick(goBack);

  const isHoldKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { goBack(); return; }
    if (!isHoldKey(e) || phase !== "hold" || back.el.contains(e.target as Node)) return;
    e.preventDefault();
    if (!e.repeat) { keyHeld = true; paint(); }
  };
  const onKeyUp = (e: KeyboardEvent) => { if (isHoldKey(e)) { keyHeld = false; paint(); } };
  const onBlur = () => { pointerHeld = keyHeld = false; paint(); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  offs.push(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  if (!coarse) cursor.show("mic");
  back.show();
  hold.show(0.15);
  hold.el.focus({ preventScroll: true }); // Space or Enter can hold straight away
  gsap.to(note, { yPercent: 0, duration: 0.8, delay: 0.1, ease: ease.pop });

  return result;
};
