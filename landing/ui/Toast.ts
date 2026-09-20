import type { IconName } from "../data/manifest";
import { sound } from "../audio/sound";
import { ease, gsap } from "../motion";
import { h } from "./dom";
import { icon } from "./icons";

// Onboarding toast (spec A4, C2): cream card, icon circle left, two lines right.
export class Toast {
  el = h("div", "card toast");
  private shown = false;
  private action?: () => void;

  constructor(private ui: HTMLElement) {
    this.el.setAttribute("role", "status");
    // a toast that points at something can be clicked to do that thing
    this.el.addEventListener("click", () => this.action?.());
    // an empty card is short enough to peek over the edge, so it is also hidden
    gsap.set(this.el, { yPercent: 160, xPercent: -50, rotate: -2, autoAlpha: 0 });
    ui.appendChild(this.el);
  }

  async show(iconName: IconName, lines: string[], autoHide = 0, action?: () => void) {
    if (this.shown) await this.hide();
    this.el.innerHTML = `<span class="card-icon">${icon(iconName, 36)}</span><span class="toast-text">${lines.map((l) => `<span>${l}</span>`).join("")}</span>`;
    this.shown = true;
    this.action = action;
    this.el.classList.toggle("clickable", !!action);
    this.ui.dispatchEvent(new CustomEvent("sense:card", { detail: true }));
    void sound.sfx("paperSlide", 0.5);
    gsap.killTweensOf(this.el);
    gsap.set(this.el, { autoAlpha: 1 });
    await gsap.to(this.el, { yPercent: 0, duration: 0.8, ease: ease.pop });
    if (autoHide) gsap.delayedCall(autoHide, () => void this.hide());
  }

  async hide() {
    if (!this.shown) return;
    this.shown = false;
    gsap.killTweensOf(this.el);
    await gsap.to(this.el, { yPercent: 160, duration: 0.5, ease: ease.exit });
    gsap.set(this.el, { autoAlpha: 0 });
    this.ui.dispatchEvent(new CustomEvent("sense:card", { detail: false }));
  }

  destroy() { gsap.killTweensOf(this.el); this.el.remove(); }
}
