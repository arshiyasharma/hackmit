import { manifest } from "../data/manifest";
import { ease, gsap } from "../motion";
import { h } from "./dom";
import { icon } from "./icons";
import { Tile } from "./Tile";

// Title card (spec A2, C1, B4): a justified lockup in a narrow column. The
// eyebrow row fades in at the exact center, slides up, the title rows fade in
// top to bottom, then the body and the Enter tile once loading is done.
export class TitleCard {
  el = h("section", "title-card");
  private enter: Tile;
  private spinner = h("span", "title-spinner");
  private ready = false;
  private introDone = false;

  constructor(ui: HTMLElement) {
    const s = manifest.strings.title;
    const row = (words: string[], cls: string) => `<div class="title-row ${cls}">${words.map((w) => `<span>${w}</span>`).join("")}</div>`;
    this.el.innerHTML = `
      <p class="title-notice">${icon("sound", 22)}<span>${s.notice.map((l) => `<span>${l}</span>`).join("")}</span></p>
      <div class="title-column">
        <h1 class="sr">Sense presents: fill the room, tap once</h1>
        <div aria-hidden="true">
          ${row(s.eyebrow, "title-eyebrow")}
          ${s.rows.map((r) => row(r, "title-main")).join("")}
          ${row(s.spread.split(""), "title-main")}
        </div>
        <p class="title-body">${s.body.map((l) => `<span>${l}</span>`).join("")}</p>
        <div class="title-enter"></div>
      </div>`;
    const slot = this.el.querySelector<HTMLElement>(".title-enter")!;
    slot.appendChild(this.spinner);
    this.enter = new Tile(slot, { icon: "door", label: s.enter, aria: "Enter the experience", rest: -1, from: "bottom" });
    ui.appendChild(this.el);
  }

  /** Plays the entrance. Resolves when the shopper clicks Enter. */
  async run(loaded: Promise<unknown>, quick = false) {
    const eyebrow = this.el.querySelector(".title-eyebrow")!;
    const mains = this.el.querySelectorAll(".title-main");
    const column = this.el.querySelector<HTMLElement>(".title-column")!;
    const speed = quick ? 0.01 : 1;
    // start with the eyebrow row alone at the exact vertical center
    const rest = column.getBoundingClientRect();
    const eb = eyebrow.getBoundingClientRect();
    const offset = window.innerHeight / 2 - (eb.top + eb.height / 2);
    void rest;

    const tl = gsap.timeline();
    tl.set(eyebrow, { y: offset })
      .to(eyebrow, { opacity: 1, duration: 0.6 * speed, ease: "power1.out" }, 1.0 * speed)
      .to(eyebrow, { y: 0, duration: 0.9 * speed, ease: ease.slide }, 1.9 * speed)
      .to(mains, { opacity: 1, duration: 0.6 * speed, stagger: 0.18 * speed, ease: "power1.out" }, 2.2 * speed)
      .to(this.el.querySelector(".title-notice"), { opacity: 1, duration: 0.65 * speed, ease: "power1.inOut" }, 2.4 * speed)
      .to(this.el.querySelector(".title-body"), { opacity: 1, duration: 0.6 * speed, ease: "power1.out" }, 3.6 * speed)
      .call(() => { this.introDone = true; this.maybeShowEnter(); }, [], 4.0 * speed);

    void loaded.then(() => { this.ready = true; this.maybeShowEnter(); });
    await new Promise<void>((resolve) => this.enter.onClick(() => { if (this.enter.shown) resolve(); }));
    this.enter.el.style.pointerEvents = "none";
  }

  private maybeShowEnter() {
    if (!this.ready || !this.introDone || this.enter.shown) return;
    this.spinner.remove();
    this.enter.show();
  }

  /** Dim to black, then get out of the way of the scene fading up behind. */
  async leave() {
    await gsap.to(this.el.children, { opacity: 0, duration: 0.6, ease: "power1.in" });
    await gsap.to(this.el, { backgroundColor: "#000", duration: 0.4, ease: "none" });
    gsap.to(this.el, { opacity: 0, duration: 1.0, ease: "power1.inOut", onComplete: () => this.el.remove() });
  }

  destroy() { gsap.killTweensOf(this.el); this.el.remove(); }
}
