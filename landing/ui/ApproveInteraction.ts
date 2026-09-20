import { sound } from "../audio/sound";
import { manifest } from "../data/manifest";
import { ease, gsap, wait } from "../motion";
import { h } from "./dom";
import { icon } from "./icons";
import { ringMarkup, setRing } from "./ProgressCursor";
import { clearReceipts, runReceipts } from "./ReceiptsReel";
import { Tile } from "./Tile";
import type { Interaction } from "./types";

// Approve once (spec B1, B4, M7, E3 item 9): an HTML phone interface glued to
// the measured screen rect of T3_phone_up. One tap, then one hold that fills
// the shared progress ring. The hold is a timer and nothing else: no WebAuthn,
// no camera, no microphone, no data collected or sent.

const HOLD_SECONDS = 1.2;
const DRAIN_SECONDS = 0.6;

// When the photographed screen cannot carry the interface, the interface lifts
// off the still and presents at a readable size, with the photographed screen
// left lit underneath so it still reads as the phone that is asking.
// Two tests, because they fail for different reasons:
//   phones: the cover-fit projects the screen ~150px wide at 375 x 667, where
//     Approve is 35px tall, under the 44px touch target. A width test, never a
//     projected-size one, because iOS resizes the viewport as the URL bar comes
//     and goes and that must not flip the presentation mid-scene.
//   everything else: below 176px projected, the 12.5 unit caption falls under
//     the 11px label floor. Desktop windows only resize when someone drags them.
const SHEET_W = 768;
const MIN_GLUED_W = 176;

export const runApprove: Interaction = async (ctx) => {
  const { ui, stage } = ctx;
  const flat = stage.flat;
  const s = manifest.strings.approve;
  const screenRect = manifest.phoneScreen;
  const reduced = () => stage.reduced;

  await ctx.enterFlat(manifest.approve.up, manifest.approve.down);

  // ---- DOM ------------------------------------------------------------------
  const root = h("div", "layer approve-layer");
  root.dataset.mode = "glued";
  // the glued box: the measured screen rect of the still. It carries the lit
  // plate, and the interface too while it is glued on top of it.
  const phone = h("div", "approve-phone");
  phone.appendChild(h("div", "approve-plate"));
  const screen = h("div", "approve-screen");
  const mark = h("span", "approve-mark");
  // the product name, not the old unused title lockup
  mark.textContent = manifest.strings.intro.name;
  const lines = h("div", "approve-lines");
  s.lines.forEach((line, i) => {
    const p = h("p", i === s.lines.length - 1 ? "approve-line approve-total" : "approve-line");
    p.textContent = line;
    lines.appendChild(p);
  });
  const head = h("div", "approve-head");
  head.append(mark, lines);

  const action = h("div", "approve-action");
  const button = h("button", "approve-button");
  button.type = "button";
  button.setAttribute("aria-label", s.button);
  button.appendChild(h("span", "approve-button-in")).textContent = s.button;

  const holdWrap = h("div", "approve-hold-wrap");
  const hold = h("button", "approve-hold", `${ringMarkup(46)}<span class="approve-glyph">${icon("fingerprint", 24)}</span>`);
  hold.type = "button";
  hold.setAttribute("aria-label", s.ring);
  hold.tabIndex = -1;
  const caption = h("p", "approve-caption");
  caption.textContent = s.ring;
  holdWrap.append(hold, caption);
  action.append(button, holdWrap);
  screen.append(head, action);

  const note = h("div", "approve-note");
  note.appendChild(h("span", "approve-note-in")).textContent = s.note;

  // the interface is a sibling of the glued box, not a child of it: lifting it
  // off the still is then a matter of dropping the inline geometry below
  root.append(phone, screen, note);
  const surfaces = [phone, screen];
  const back = new Tile(root, { icon: "back", aria: "Back to the room", rest: -4, from: "left", className: "hud-back" });
  ui.appendChild(root);

  // ---- state ----------------------------------------------------------------
  let armed = false;      // the hold is on screen
  let holding = false;
  let progress = 0;
  let finished = false;   // the ring completed, back is no longer possible
  let left = false;       // the shopper backed out
  let held: () => void = () => {};
  const holdDone = new Promise<void>((resolve) => { held = resolve; });
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
    el.addEventListener(type, fn as EventListener);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener));
  };

  // Glue the phone to the still every frame, so it survives resizes and
  // rotation. The interface rides along with it until the viewport is too small
  // to hold it, and then only the lit plate stays glued. The same callback runs
  // the hold timer.
  let placed = "";
  let sheet = false;
  const frame = (dt: number) => {
    const p = flat.projectFlat(screenRect.cx, screenRect.cy);
    const w = screenRect.w * flat.pw;
    const hgt = screenRect.h * flat.ph;
    const lift = flat.W < SHEET_W || w < MIN_GLUED_W;
    const key = `${lift ? "s" : "g"}|${p.x.toFixed(1)}|${p.y.toFixed(1)}|${w.toFixed(1)}|${hgt.toFixed(1)}`;
    if (key !== placed) {
      placed = key;
      if (lift !== sheet) {
        sheet = lift;
        root.dataset.mode = sheet ? "sheet" : "glued";
        // hand the interface's geometry back to the stylesheet, which sizes
        // and places the sheet in real pixels
        for (const prop of ["width", "height", "transform", "--s"]) screen.style.removeProperty(prop);
      }
      const box = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) rotate(${screenRect.rot}deg)`;
      for (const el of sheet ? [phone] : surfaces) {
        el.style.width = `${w.toFixed(1)}px`;
        el.style.height = `${hgt.toFixed(1)}px`;
        el.style.setProperty("--s", (w / 200).toFixed(4));
        el.style.transform = box;
      }
    }
    if (!armed || finished) return;
    progress = Math.min(1, Math.max(0, progress + (holding ? dt / HOLD_SECONDS : -dt / DRAIN_SECONDS)));
    setRing(hold, progress);
    if (progress >= 1) { finished = true; held(); }
  };
  let unframe: (() => void) | null = stage.onFrame(frame);
  const stopFrame = () => { unframe?.(); unframe = null; };
  frame(0);

  const destroy = () => {
    stopFrame();
    for (const fn of cleanups.splice(0)) fn();
    gsap.killTweensOf([...surfaces, note, button, holdWrap, hold, caption]);
    back.destroy();
    root.remove();
  };

  // ---- entrance ---------------------------------------------------------------
  gsap.set(holdWrap, { autoAlpha: 0 });
  gsap.fromTo(surfaces, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: ease.out });
  if (reduced()) {
    gsap.fromTo(note, { opacity: 0, rotate: -3 }, { opacity: 1, duration: 0.4, ease: ease.out, delay: 0.2 });
  } else {
    gsap.delayedCall(0.25, () => { if (!left && !finished) void sound.sfx("paperSlide", 0.5); });
    gsap.fromTo(note, { xPercent: -220, rotate: -9, opacity: 1 }, { xPercent: 0, rotate: -3, duration: 0.8, ease: ease.pop, delay: 0.25 });
  }
  back.show(0.1);

  // ---- back: tile or Escape, only until the ring completes --------------------
  const backedOut = new Promise<false>((resolve) => {
    const leave = () => { if (finished || left) return; left = true; resolve(false); };
    back.onClick(leave);
    on(window, "keydown", (e) => { if (e.key === "Escape") leave(); });
  });

  // ---- hold wiring ----------------------------------------------------------
  const setHolding = (value: boolean) => {
    if (finished || !armed) value = false;
    holding = value;
    hold.toggleAttribute("data-holding", value);
  };
  on(hold, "pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // capture the finger: a thumb drifting a few pixels off a round control is
    // normal, and it must not drain the ring or lose the pointerup
    try { hold.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    setHolding(true);
  });
  on(hold, "pointerup", () => setHolding(false));
  on(hold, "pointerleave", () => setHolding(false));
  on(hold, "pointercancel", () => setHolding(false));
  // iOS raises the callout and the selection magnifier on exactly this gesture
  on(hold, "contextmenu", (e) => e.preventDefault());
  on(hold, "selectstart", (e) => e.preventDefault());
  // keyboard: hold Space or Enter. Repeats are ignored so the Enter that
  // pressed "Approve once" cannot leak into the hold.
  on(hold, "keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) setHolding(true);
  });
  on(hold, "keyup", (e) => { if (e.key === " " || e.key === "Enter") setHolding(false); });
  on(hold, "blur", () => setHolding(false));

  // ---- the approval: one tap, then one hold -----------------------------------
  const approval = (async (): Promise<boolean> => {
    await new Promise<void>((resolve) => on(button, "click", () => resolve()));
    if (left) return false;
    const hadFocus = document.activeElement === button;
    button.disabled = true;
    const line6 = ctx.say(6);
    await gsap.to(button, { autoAlpha: 0, scale: reduced() ? 1 : 0.94, duration: 0.3, ease: ease.out });
    if (left) return false;
    hold.tabIndex = 0;
    armed = true;
    // visible before the focus call, a hidden button cannot take focus
    gsap.set(holdWrap, { visibility: "visible" });
    if (hadFocus) hold.focus({ preventScroll: true });
    gsap.fromTo(holdWrap, { opacity: 0, y: reduced() ? 0 : 8 }, { opacity: 1, y: 0, duration: 0.5, ease: ease.out });

    await holdDone;
    setHolding(false);
    back.hide();
    void sound.sfx("chime");
    // brief check state on the phone
    hold.disabled = true;
    hold.dataset.state = "done";
    hold.querySelector(".approve-glyph")!.innerHTML = icon("check", 24);
    gsap.to(caption, { opacity: 0, duration: 0.3, ease: ease.out });
    if (!reduced()) gsap.fromTo(hold, { scale: 0.86 }, { scale: 1, duration: 0.5, ease: ease.pop });
    // never talk over line 6 if the hold was quicker than the voice
    await Promise.all([line6, wait(0.7)]);
    return true;
  })();

  const approved = await Promise.race([backedOut, approval]);
  if (!approved) {
    back.hide();
    gsap.killTweensOf([...surfaces, note]);
    gsap.to(note, { opacity: 0, duration: 0.3, ease: ease.out });
    await gsap.to(surfaces, { opacity: 0, duration: 0.3, ease: ease.out });
    destroy();
    return false;
  }

  // ---- phone down: all UI hides, the still swaps to the face-down phone ------
  const line7 = ctx.say(7);
  gsap.killTweensOf(note);
  if (reduced()) gsap.to(note, { opacity: 0, duration: 0.4, ease: ease.out });
  else gsap.to(note, { xPercent: -220, rotate: -9, duration: 0.5, ease: ease.exit });
  await gsap.to(surfaces, { opacity: 0, duration: 0.4, ease: ease.out });
  stopFrame();
  for (const el of surfaces) el.remove();
  const mix = flat.uniforms.uMix;
  await gsap.to(mix, { value: 1, duration: reduced() ? 0.4 : 0.8, ease: ease.slide });
  flat.commit();
  await line7;

  await runReceipts(ctx);

  const card = manifest.strings.afterReceipts;
  await ctx.reward.show({ icon: "check", text: card.card, button: card.button });
  await clearReceipts(ctx, 0.3);
  gsap.killTweensOf(mix);
  destroy();
  return true;
};
