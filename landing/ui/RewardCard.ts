import type { IconName } from "../data/manifest";
import { sound } from "../audio/sound";
import { ease, gsap } from "../motion";
import { h, rich } from "./dom";
import { icon } from "./icons";

// Reward card (spec A5, C2): icon circle, two centered lines with key words in
// blue, one wiggling button. Resolves with how the shopper left it.
export class RewardCard {
  el = h("div", "card reward");
  private shown = false;

  constructor(private ui: HTMLElement) {
    // an empty card is short enough to peek over the edge, so it is also hidden
    gsap.set(this.el, { yPercent: 160, xPercent: -50, rotate: -2, autoAlpha: 0 });
    ui.appendChild(this.el);
  }

  async show(opts: { icon: IconName; text: string; button: string; dismissible?: boolean; delay?: number }): Promise<"button" | "close"> {
    if (this.shown) { await this.hide(); await gsap.delayedCall(0.4, () => {}); }
    this.el.innerHTML = `
      <span class="card-icon">${icon(opts.icon, 36)}</span>
      <p class="reward-text">${rich(opts.text)}</p>
      <button type="button" class="card-button"><span class="wiggle">${opts.button}</span></button>
      ${opts.dismissible ? `<button type="button" class="card-close" aria-label="Close">${icon("close", 14)}</button>` : ""}`;
    this.shown = true;
    this.ui.dispatchEvent(new CustomEvent("sense:card", { detail: true }));
    gsap.killTweensOf(this.el);
    gsap.set(this.el, { autoAlpha: 1 });
    gsap.delayedCall(opts.delay ?? 0, () => void sound.sfx("paperSlide", 0.5));
    await gsap.to(this.el, { yPercent: 0, duration: 0.8, ease: ease.pop, delay: opts.delay ?? 0 });
    const result = await new Promise<"button" | "close">((resolve) => {
      this.el.querySelector(".card-button")!.addEventListener("click", () => resolve("button"), { once: true });
      this.el.querySelector(".card-close")?.addEventListener("click", () => resolve("close"), { once: true });
    });
    await this.hide();
    return result;
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
