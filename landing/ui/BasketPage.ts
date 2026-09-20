import Lenis from "lenis";
import { sound } from "../audio/sound";
import { asset, manifest, money, pieceById, type ChapterIndex, type Piece, type PieceId } from "../data/manifest";
import { ease, gsap, reducedMotion, T, wait } from "../motion";
import { store } from "../state/store";
import { h, rich } from "./dom";
import { icon } from "./icons";
import { Tile } from "./Tile";
import type { Ctx } from "./types";

// Basket page (spec A6, B4, M4) plus the paper page shell it shares with the
// finale (C4 "Page slide in"): field flood, slide in from the right, cover
// strip, Lenis scroll on the page's own wrapper, close tile, Escape.

// ---- shared paper parts (C2) --------------------------------------------------

/** An image that may be missing: the wrapper turns into a tinted block naming the file. */
export function pic(path: string, className: string, alt = "") {
  const box = h("span", `page-pic ${className}`);
  const img = h("img");
  img.alt = alt;
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("error", () => {
    box.classList.add("missing");
    box.dataset.name = path.split("/").pop() ?? path;
  }, { once: true });
  img.src = asset(path);
  box.appendChild(img);
  return box;
}

/** Tape strip from the paper kit, or the CSS strip when the file is missing. */
export function tapeStrip(index: number, rot: number) {
  const tape = h("span", "page-tape");
  tape.setAttribute("aria-hidden", "true");
  tape.style.setProperty("--rot", `${rot}deg`);
  const img = h("img");
  img.alt = "";
  img.draggable = false;
  img.addEventListener("error", () => { img.remove(); tape.classList.add("fallback"); }, { once: true });
  img.src = asset(manifest.paper.tapes[index % manifest.paper.tapes.length]);
  tape.appendChild(img);
  return tape;
}

/** Instant photo card: white frame, square image, paper noise. The figure carries the rest rotation. */
export function photoCard(path: string, alt: string, rot: number) {
  const card = h("figure", "page-photo");
  card.style.setProperty("--rot", `${rot}deg`);
  card.appendChild(pic(path, "page-photo-img", alt));
  return card;
}

/** The sofa photo follows the chosen fabric: P_sofa for oat, else a square crop of the fabric still. */
export function sofaPhoto() {
  const fabric = manifest.fabrics.find((f) => f.id === store.state.fabric) ?? manifest.fabrics[0];
  return { fabric, path: fabric.id === "oat" ? pieceById("sofa").photo : fabric.still };
}

// ---- page shell -----------------------------------------------------------------

const OFFSCREEN = 106; // xPercent: past 100 so the tilted corners start fully outside
const GHOST_SPOTS = [[4, -4], [27, 3], [51, -2], [74, 4]]; // top %, rotation deg

export abstract class PaperPage {
  protected root = h("div", "page-root");
  protected sheet = h("div", "page-sheet");
  protected scroller = h("div", "page-scroll");
  protected content = h("div", "page-content");
  protected closeTile: Tile;
  protected lenis?: Lenis;
  protected leaving = false;
  private flood = h("div", "page-flood");
  private landedOnce = false;
  private dead = false;
  private closed?: Promise<void>;
  private resolveClosed?: () => void;

  constructor(protected ctx: Ctx, name: string, label: string, closeAria: string) {
    this.root.classList.add(`page-${name}`);
    this.root.hidden = true;
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-modal", "true");
    this.sheet.setAttribute("aria-label", label);
    this.sheet.style.backgroundImage = `url("${asset(manifest.paper.page)}")`;
    // focusable so the arrow keys and space scroll the page
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute("role", "region");
    this.scroller.setAttribute("aria-label", label);
    this.content.classList.add(`${name}-content`);
    this.content.appendChild(this.ghost());
    this.scroller.appendChild(this.content);
    this.sheet.append(h("div", "page-cover"), this.scroller);
    this.closeTile = new Tile(this.sheet, { icon: "close", aria: closeAria, rest: 2, from: "top", className: "page-close" });
    this.closeTile.hide();
    this.closeTile.onClick(() => void this.close());
    this.root.append(this.flood, this.sheet);
    ctx.ui.appendChild(this.root);
  }

  /** Faint mirrored handwriting behind everything, written with the asks so no new copy appears. */
  private ghost() {
    const ghost = h("div", "page-ghost");
    ghost.setAttribute("aria-hidden", "true");
    const lines = [...manifest.pieces.map((p) => p.ask), manifest.strings.ask.note];
    GHOST_SPOTS.forEach(([top, rot], i) => {
      const p = h("p");
      p.textContent = `${lines[i % lines.length]} ${lines[(i + 2) % lines.length]}`;
      p.style.top = `${top}%`;
      p.style.setProperty("--rot", `${rot}deg`);
      ghost.appendChild(p);
    });
    return ghost;
  }

  /** Render for the current store state. Runs while the page is still off screen. */
  protected abstract prepare(): void;
  /** The page has landed and scrolls. */
  protected abstract landed(): void;
  /** The page starts to leave. */
  protected abstract left(): void;
  /** Return true when Escape was used up by something on the page. */
  protected onEscape() { return false; }

  protected begin(onCovered?: () => void) {
    if (this.closed) return this.closed;
    this.closed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
    void this.arrive(onCovered);
    return this.closed;
  }

  private async arrive(onCovered?: () => void) {
    const reduced = reducedMotion();
    this.leaving = false;
    this.landedOnce = false;
    this.root.hidden = false;
    this.scroller.scrollTop = 0;
    this.prepare();
    gsap.set(this.sheet, reduced ? { xPercent: 0, rotation: 0, autoAlpha: 0 } : { xPercent: OFFSCREEN, rotation: -4, autoAlpha: 0 });
    await gsap.fromTo(this.flood, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: ease.out });
    if (this.dead) return;
    onCovered?.();

    this.lenis = new Lenis({ wrapper: this.scroller, content: this.content, autoRaf: false, smoothWheel: !reduced });
    gsap.ticker.add(this.tick);
    void sound.sfx("paperSlide");
    if (reduced) await gsap.to(this.sheet, { autoAlpha: 1, duration: 0.4, ease: ease.out });
    else {
      gsap.set(this.sheet, { autoAlpha: 1 });
      await gsap.to(this.sheet, { xPercent: 0, rotation: 0, duration: T.page, ease: ease.slide });
    }
    if (this.dead) return;

    this.landedOnce = true;
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("focusin", this.onFocusIn);
    this.closeTile.show();
    this.closeTile.el.focus({ preventScroll: true });
    this.landed();
  }

  protected async close() {
    if (!this.landedOnce || this.leaving) return;
    const reduced = reducedMotion();
    this.leaving = true;
    this.unlisten();
    this.closeTile.hide();
    this.left();
    this.stopScroll();
    if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    void sound.sfx("paperTear");
    if (reduced) await gsap.to(this.sheet, { autoAlpha: 0, duration: 0.4, ease: ease.out });
    else await gsap.to(this.sheet, { xPercent: OFFSCREEN, rotation: -4, duration: 1, ease: ease.slide });
    await gsap.to(this.flood, { opacity: 0, duration: 0.35, ease: ease.out });
    this.finish();
  }

  private finish() {
    this.root.hidden = true;
    this.landedOnce = false;
    const resolve = this.resolveClosed;
    this.closed = undefined;
    this.resolveClosed = undefined;
    resolve?.();
  }

  /** Smooth scroll so the target sits a little under the top edge. Always resolves. */
  protected scrollTo(target: HTMLElement) {
    return new Promise<void>((resolve) => {
      if (!this.lenis) { resolve(); return; }
      const reduced = reducedMotion();
      // the scroller is the viewport here, and unlike window.innerHeight it does
      // not jump when the iOS URL bar slides away mid-scroll
      this.lenis.scrollTo(target, {
        offset: -this.scroller.clientHeight * 0.16, immediate: reduced, duration: T.page, easing: ease.slide, onComplete: () => resolve(),
      });
      // a wheel flick cancels the move and onComplete never fires
      gsap.delayedCall(reduced ? 0.05 : T.page + 0.3, resolve);
    });
  }

  private tick = (time: number) => this.lenis?.raf(time * 1000);

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (!this.onEscape()) void this.close();
  };

  // the HUD under the flood stays tabbable, so pull focus back onto the page
  private onFocusIn = (e: FocusEvent) => {
    if (e.target instanceof Node && !this.root.contains(e.target)) this.closeTile.el.focus({ preventScroll: true });
  };

  private unlisten() {
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("focusin", this.onFocusIn);
  }

  private stopScroll() {
    gsap.ticker.remove(this.tick);
    this.lenis?.destroy();
    this.lenis = undefined;
  }

  destroy() {
    this.dead = true;
    this.unlisten();
    this.stopScroll();
    gsap.killTweensOf([this.sheet, this.flood]);
    this.closeTile.destroy();
    this.root.remove();
    this.finish();
  }
}

// ---- basket ---------------------------------------------------------------------

interface SlotParts {
  text: HTMLElement;
  fabric?: HTMLElement;
  arrow: HTMLElement;
  photo: HTMLElement;
  tape: HTMLElement;
  tag: HTMLElement;
}
interface Slot { piece: Piece; el: HTMLElement; photoRot: number; tapeRot: number; tagRot: number; parts?: SlotParts }

const PEN_SPEED = 14; // characters per second
const CLIP_SHUT = "inset(-15% 100% -30% 0%)";
const CLIP_OPEN = "inset(-15% 0% -30% 0%)";
const SLOT_ROT = [
  { ask: -1.5, photo: 4, tape: -4, tag: -7, hole: 1.5 },
  { ask: 1, photo: -5, tape: 5, tag: 6, hole: -2 },
  { ask: -1, photo: 6, tape: -2, tag: -5, hole: 2 },
  { ask: 1.5, photo: -3, tape: 6, tag: 8, hole: -1.5 },
];
// Three doodles per slot band, on the side the zigzag leaves free: top % of the
// band, left % of the page, width px, rotation deg. Bands, not absolute page
// percentages, so the scatter keeps its density whatever the piece count is.
const DOODLE_BAND = [
  [[6, 8, 170, -12], [36, 30, 120, 9], [68, 12, 150, -4]],   // slot sits right
  [[6, 66, 160, 14], [36, 84, 110, -8], [68, 60, 140, 5]],   // slot sits left
];

/** White text on the dark fabrics, ink on the pale one. */
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luma > 150 ? "var(--ink)" : "#fff";
}

export class BasketPage extends PaperPage {
  private slots: Slot[] = [];
  private written = new Set<PieceId>();
  private chipText = h("span", "basket-chip-text");
  private totalEl = h("p", "basket-total");
  private totalNum = h("b", "basket-total-num");
  private shownTotal = 0;
  private fresh?: Slot;
  private write?: PieceId;
  private writeDone: Promise<void> = Promise.resolve();
  private totalWatch?: IntersectionObserver;

  constructor(ctx: Ctx, private onGoTo: (chapter: ChapterIndex) => void) {
    super(ctx, "basket", manifest.strings.basket.label, "Close the basket");
    this.build();
  }

  /** Opens the page. onCovered fires once the flood hides the stage. Resolves when the page has closed. */
  open(opts: { write?: PieceId; onCovered?: () => void } = {}): Promise<void> {
    this.write = opts.write;
    return this.begin(opts.onCovered);
  }

  private build() {
    const s = manifest.strings.basket;
    const header = h("header", "basket-header");
    const label = h("h2", "basket-label");
    label.textContent = s.label;
    // K_label is only a background, so probe it to fall back to a plain torn strip
    const probe = new Image();
    probe.onerror = () => label.classList.add("fallback");
    probe.src = asset(manifest.paper.label);
    label.style.backgroundImage = `url("${probe.src}")`;
    header.append(label, h("p", "basket-desc", rich(s.description)));

    // a zero-height sticky rail keeps the chip pinned without pushing the budget line down
    const rail = h("div", "basket-rail");
    const chip = h("div", "basket-chip", `<span class="basket-chip-icon">${icon("bag", 22)}</span>`);
    chip.appendChild(this.chipText);
    rail.appendChild(chip);
    const budget = h("p", "basket-budget", `<span class="page-boil"></span>`);
    budget.firstElementChild!.textContent = s.budget;

    const list = h("div", "basket-slots");
    const bands = manifest.pieces.length;
    manifest.pieces.forEach((_, band) => {
      DOODLE_BAND[band % DOODLE_BAND.length].forEach(([top, left, width, rot], j) => {
        const path = manifest.paper.doodles[(band * 3 + j) % manifest.paper.doodles.length];
        const doodle = h("span", "basket-doodle");
        doodle.setAttribute("aria-hidden", "true");
        // --top/--left, not top/left: the mobile rule caps the left so a 24vw scan
        // cannot run off the right edge of a phone
        const top100 = ((band + top / 100) / bands) * 100;
        doodle.style.cssText = `--top:${top100.toFixed(2)}%;--left:${left}%;--w:${width}px;--rot:${rot}deg`;
        const boil = h("span", "page-boil");
        const img = h("img");
        img.alt = "";
        img.draggable = false;
        // a missing doodle is simply absent, a labelled block would read as content
        img.addEventListener("error", () => doodle.remove(), { once: true });
        img.src = asset(path);
        boil.appendChild(img);
        doodle.appendChild(boil);
        list.appendChild(doodle);
      });
    });
    manifest.pieces.forEach((piece, i) => {
      const el = h("section", `basket-slot ${i % 2 === 0 ? "right" : "left"}`);
      el.setAttribute("aria-label", `${piece.slot}. ${piece.ask}`);
      const rot = SLOT_ROT[i % SLOT_ROT.length];
      this.slots.push({ piece, el, photoRot: rot.photo, tapeRot: rot.tape, tagRot: rot.tag });
      list.appendChild(el);
    });

    const [before, after] = s.total.split("${sum}");
    this.totalEl.append(before ?? "", this.totalNum, after ?? "");
    this.content.append(header, rail, budget, list, this.totalEl);
  }

  protected prepare() {
    this.fresh = undefined;
    for (const slot of this.slots) {
      const id = slot.piece.id;
      const earned = store.has(id);
      const fresh = earned && id === this.write && !this.written.has(id);
      if (earned) this.fill(slot, fresh); else this.empty(slot);
      if (fresh) this.fresh = slot; else if (earned) this.written.add(id);
    }
    this.chipText.textContent = manifest.strings.basket.counter.replace("{n}", String(store.count));
    this.totalNum.textContent = money(this.shownTotal);
  }

  private empty(slot: Slot) {
    const { piece, el } = slot;
    const rot = SLOT_ROT[(piece.slot - 1) % SLOT_ROT.length];
    const label = manifest.strings.basket.goTo[piece.chapter];
    slot.parts = undefined;
    el.dataset.state = "empty";
    el.innerHTML = `
      <div class="basket-ask" style="--rot:${rot.ask}deg" aria-hidden="true">
        <span class="basket-num">${piece.slot}.</span><span class="basket-dashes"><i></i><i></i></span>
      </div>
      <div class="basket-stage">
        <div class="basket-hole" style="--rot:${rot.hole}deg">
          <button type="button" class="card-button basket-go"><span class="wiggle"></span></button>
        </div>
      </div>`;
    const button = el.querySelector<HTMLButtonElement>(".basket-go")!;
    button.firstElementChild!.textContent = label;
    button.setAttribute("aria-label", `${label}: ${piece.ask}`);
    button.addEventListener("click", () => {
      if (this.leaving) return;
      void this.close();
      this.onGoTo(piece.chapter);
    });
  }

  private fill(slot: Slot, fresh: boolean) {
    const { piece, el } = slot;
    const rot = SLOT_ROT[(piece.slot - 1) % SLOT_ROT.length];
    const sofa = piece.id === "sofa" ? sofaPhoto() : undefined;
    el.dataset.state = "filled";
    el.innerHTML = "";

    const hand = (className: string, value: string) => {
      const line = h("div", className, `<span class="page-boil"><span class="basket-hand"></span></span>`);
      const text = line.querySelector<HTMLElement>(".basket-hand")!;
      text.textContent = value;
      return { line, text };
    };
    const ask = hand("basket-ask", `${piece.slot}. ${piece.ask}`);
    ask.line.style.setProperty("--rot", `${rot.ask}deg`);
    ask.text.classList.add("basket-ask-text");
    el.appendChild(ask.line);
    const fabric = sofa ? hand("basket-fabric", sofa.fabric.name) : undefined;
    if (fabric) el.appendChild(fabric.line);

    const stage = h("div", "basket-stage");
    const arrow = h("span", "basket-arrow", icon("curvedArrow", 52));
    arrow.setAttribute("aria-hidden", "true");
    const photo = photoCard(sofa?.path ?? piece.photo, piece.name, slot.photoRot);
    const tape = tapeStrip(piece.slot - 1, slot.tapeRot);
    const tag = h("figcaption", "basket-tag", `<b></b><span></span>`);
    tag.children[0].textContent = piece.shop;
    tag.children[1].textContent = money(piece.price);
    tag.style.setProperty("--rot", `${slot.tagRot}deg`);
    if (sofa) { tag.style.background = sofa.fabric.color; tag.style.color = inkOn(sofa.fabric.color); }
    photo.append(tape, tag);
    stage.append(arrow, photo);
    el.appendChild(stage);

    slot.parts = { text: ask.text, fabric: fabric?.text, arrow, photo, tape, tag };
    if (!fresh) { ask.text.classList.add("inked"); return; }
    // hold everything back until the pen gets here
    const hidden = [arrow, photo, tape, tag];
    const texts = fabric ? [ask.text, fabric.text] : [ask.text];
    gsap.set(hidden, { autoAlpha: 0 });
    gsap.set(texts, reducedMotion() ? { autoAlpha: 0 } : { clipPath: CLIP_SHUT });
  }

  protected landed() {
    const fresh = this.fresh;
    this.writeDone = fresh ? this.writeOn(fresh) : Promise.resolve();
    // the total only counts once it is on screen and the pen has finished
    this.totalWatch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void this.countUp();
    }, { root: this.scroller, threshold: 0.6 });
    this.totalWatch.observe(this.totalEl);
  }

  protected left() {
    this.totalWatch?.disconnect();
    this.totalWatch = undefined;
  }

  /** Spec E3 item 5: handwriting, underline, arrow, photo with tape, tag, in that order. */
  private async writeOn(slot: Slot) {
    const p = slot.parts!;
    const reduced = reducedMotion();
    this.written.add(slot.piece.id);
    await this.scrollTo(slot.el);
    if (this.leaving) return;

    const pen = async (el: HTMLElement) => {
      void sound.sfx("pen", 0.6);
      if (reduced) { await gsap.to(el, { autoAlpha: 1, duration: 0.4, ease: ease.out }); return; }
      // a pen moves at a steady pace, so this one tween is linear on purpose
      await gsap.to(el, { clipPath: CLIP_OPEN, duration: (el.textContent?.length ?? 1) / PEN_SPEED, ease: "none" });
      gsap.set(el, { clearProps: "clipPath" });
    };
    await pen(p.text);
    if (p.fabric) await pen(p.fabric);

    p.text.classList.add("drawing");
    await wait(0.6);

    if (reduced) {
      for (const el of [p.arrow, p.photo, p.tape, p.tag]) await gsap.to(el, { autoAlpha: 1, duration: 0.4, ease: ease.out });
      return;
    }
    await gsap.fromTo(p.arrow, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: ease.pop });
    gsap.fromTo(p.tape,
      { autoAlpha: 0, y: -18, scale: 1.25, rotation: slot.tapeRot },
      { autoAlpha: 1, y: 0, scale: 1, rotation: slot.tapeRot, duration: 0.4, delay: 0.4, ease: ease.pop });
    await gsap.fromTo(p.photo,
      { autoAlpha: 0, y: -70, scale: 1.12, rotation: slot.photoRot - 9 },
      { autoAlpha: 1, y: 0, scale: 1, rotation: slot.photoRot, duration: 0.8, ease: ease.pop });
    await gsap.fromTo(p.tag,
      { autoAlpha: 0, scale: 0.5, rotation: slot.tagRot - 18 },
      { autoAlpha: 1, scale: 1, rotation: slot.tagRot, duration: 0.5, ease: ease.pop });
  }

  private async countUp() {
    const target = store.total;
    if (target === this.shownTotal) return;
    this.totalWatch?.disconnect();
    await this.writeDone;
    if (this.leaving) return;
    const from = this.shownTotal;
    this.shownTotal = target;
    if (reducedMotion()) { this.totalNum.textContent = money(target); return; }
    const value = { n: from };
    gsap.to(value, {
      n: target, duration: 1.2, ease: ease.out,
      onUpdate: () => { this.totalNum.textContent = money(Math.round(value.n)); },
    });
  }

  destroy() {
    this.left();
    super.destroy();
  }
}
