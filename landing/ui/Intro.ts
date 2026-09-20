import { asset, manifest } from "../data/manifest";
import { ease, gsap, reducedMotion } from "../motion";
import { h, rich } from "./dom";
import { icon } from "./icons";
import { Tile } from "./Tile";

// The opening, in two beats on one sheet of paper:
//   1. The room draws itself in contour lines from both screen edges.
//   2. A watercolour wash floods the drawing, then the copy settles on top.
// The sheet becomes the page, so the intro never cuts to a different screen.

export class Intro {
  el = h("section", "intro");
  private copy!: HTMLElement;
  private enter!: Tile;
  /** the master timeline, public so a test can scrub to an exact beat */
  tl?: gsap.core.Timeline;
  private reduced = reducedMotion();
  private ready = false;
  private ended = false;

  constructor(ui: HTMLElement) {
    const s = manifest.strings.intro;
    // the name says what the product does, so the -AR half is tinted; the
    // hyphen is its own span because it needs lifting between capitals
    const cut = s.name.indexOf("-");
    const name = cut < 0 ? s.name
      : `${s.name.slice(0, cut)}<span class="name-dash">-</span><span class="name-ar">${s.name.slice(cut + 1)}</span>`;

    // the wash is a 2560px AVIF decoded at the exact frame the flood starts, so
    // it decodes off the main thread; on a phone that decode is a visible stutter
    this.el.innerHTML = `
      <div class="intro-hero" aria-hidden="true">
        <div class="hero-line" data-side="l"></div>
        <div class="hero-line" data-side="r"></div>
        <i class="hero-pen" data-side="l"></i>
        <i class="hero-pen" data-side="r"></i>
        <img class="hero-wc" src="${asset(manifest.intro.watercolor)}" alt="" decoding="async">
      </div>
      <p class="intro-notice">${icon("sound", 15)}<span>${s.notice}</span></p>
      <div class="intro-copy">
        <h1 class="intro-name">${name}</h1>
        <p class="intro-deck">${rich(s.deck)}</p>
        <p class="intro-action">${s.action}</p>
        <div class="intro-enter"></div>
      </div>`;

    this.copy = this.el.querySelector(".intro-copy")!;
    this.el.style.setProperty("--line-src", `url("${asset(manifest.intro.line)}")`);
    this.enter = new Tile(this.el.querySelector(".intro-enter")!, {
      icon: "door", label: s.enter, aria: "Enter the experience", rest: -1, from: "bottom",
    });
    ui.appendChild(this.el);
  }

  /** Plays the sequence. Resolves when the visitor clicks Enter. */
  async run(loaded: Promise<unknown>) {
    void loaded.then(() => { this.ready = true; if (this.ended) this.enter.show(); });

    // a click anywhere during the show jumps to the end, so nobody is held hostage
    const skip = (e: Event) => { if (!this.enter.el.contains(e.target as Node)) this.finish(); };
    this.el.addEventListener("pointerdown", skip);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") this.finish(); };
    window.addEventListener("keydown", onKey);

    this.tl = this.reduced ? this.buildStill() : this.build();
    this.tl.eventCallback("onComplete", () => this.end());

    await new Promise<void>((resolve) => this.enter.onClick(() => { if (this.enter.shown) resolve(); }));
    this.enter.el.style.pointerEvents = "none";
    window.removeEventListener("keydown", onKey);
    this.el.removeEventListener("pointerdown", skip);
  }

  private q<T extends Element = HTMLElement>(sel: string) {
    return [...this.el.querySelectorAll<T>(sel)];
  }

  private build() {
    const tl = gsap.timeline();

    // beat 1: the room draws itself in from both edges, a pen at each leading edge
    tl.to(this.q(".intro-notice"), { opacity: 1, duration: 0.6, ease: "power1.out" }, 0.3)
      .fromTo(this.q('.hero-line[data-side="l"]'), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 50% 0 0)", duration: 1.8, ease: ease.slide }, 0.15)
      .fromTo(this.q('.hero-line[data-side="r"]'), { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 50%)", duration: 1.8, ease: ease.slide }, 0.15)
      .fromTo(this.q('.hero-pen[data-side="l"]'), { left: "0%", opacity: 0 }, { left: "50%", opacity: 1, duration: 1.8, ease: ease.slide }, 0.15)
      .fromTo(this.q('.hero-pen[data-side="r"]'), { right: "0%", opacity: 0 }, { right: "50%", opacity: 1, duration: 1.8, ease: ease.slide }, 0.15)
      .to(this.q(".hero-pen"), { opacity: 0, duration: 0.3, ease: "power1.in" }, 1.65);

    // beat 2: the wash floods up through the drawing, then the copy settles on it
    const washAt = 1.7;
    const wash = { v: -25 };
    tl.to(this.q(".hero-wc"), { opacity: 1, duration: 0.5, ease: "none" }, washAt)
      .to(wash, {
        v: 130, duration: 1.4, ease: "power1.inOut",
        onUpdate: () => this.el.style.setProperty("--wash", `${wash.v}%`),
      }, washAt)
      .to(this.q(".hero-line"), { opacity: 0.3, duration: 1.0, ease: "power1.inOut" }, washAt + 0.35)
      .to(this.copy, { opacity: 1, duration: 0.75, ease: ease.out }, washAt + 0.95)
      .fromTo(this.q(".intro-copy > *"), { y: 14 }, { y: 0, duration: 0.85, stagger: 0.07, ease: ease.out }, washAt + 0.95);

    return tl;
  }

  /** Reduced motion: no wipes, no travel, just the finished page. */
  private buildStill() {
    gsap.set(this.q(".hero-line"), { clipPath: "inset(0 0 0 0)", opacity: 0.3 });
    this.el.style.setProperty("--wash", "130%");
    return gsap.timeline()
      .to(this.q(".intro-notice"), { opacity: 1, duration: 0.3 }, 0)
      .to(this.q(".hero-wc"), { opacity: 1, duration: 0.4 }, 0)
      .to(this.copy, { opacity: 1, duration: 0.4 }, 0.3);
  }

  /** Jump to the finished page, on a skip click or when the show ends. */
  private finish() {
    if (this.ended || !this.tl) return;
    this.tl.progress(1, false);
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    if (this.ready) this.enter.show();
  }

  /** Dissolve the paper away; the real room is already exposing up behind it. */
  async leave() {
    gsap.killTweensOf(this.el);
    await gsap.to(this.el, { opacity: 0, duration: 1.2, ease: "power1.inOut" });
    this.el.remove();
  }

  destroy() {
    this.tl?.kill();
    gsap.killTweensOf(this.el);
    this.el.remove();
  }
}
