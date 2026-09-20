import { gsap } from "../motion";
import { h } from "./dom";

// One short yellow line at a time, bottom center (spec A3, C1).
export class Subtitles {
  el = h("p", "subtitles");

  constructor(ui: HTMLElement) {
    this.el.setAttribute("aria-live", "polite");
    ui.appendChild(this.el);
  }

  async show(line: string, seconds: number) {
    gsap.killTweensOf(this.el);
    this.el.textContent = line;
    await gsap.to(this.el, { opacity: 1, duration: 0.35, ease: "power1.out" });
    await gsap.to(this.el, { opacity: 0, duration: 0.35, ease: "power1.in", delay: Math.max(0.4, seconds - 0.7) });
  }

  destroy() {
    gsap.killTweensOf(this.el);
    this.el.remove();
  }
}
