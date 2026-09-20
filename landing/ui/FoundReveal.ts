import { asset } from "../data/manifest";
import { ease, gsap } from "../motion";
import { h } from "./dom";

// Found-object reveal (spec A5 and the found reveal row in C4). The push, blur,
// and veil are driven by main through the stage; this module owns the type and
// the flat cut-out: eyebrow at 0.4s, title at 0.7s, cut-out at 0.9s.
export class FoundReveal {
  el = h("div", "reveal");

  constructor(private ui: HTMLElement) {
    ui.appendChild(this.el);
  }

  show(opts: { eyebrow: string; title: string; cutout?: string; tilt: number; placeholder?: string }) {
    this.el.innerHTML = `
      <div class="reveal-head"><span class="eyebrow">${opts.eyebrow}</span><span class="reveal-title">${opts.title}</span></div>
      <div class="reveal-cutout">${opts.cutout ? `<img src="${asset(opts.cutout)}" alt="">` : `<div class="ph">${opts.placeholder ?? ""}</div>`}</div>`;
    const [eyebrow, title] = Array.from(this.el.querySelectorAll<HTMLElement>(".reveal-head > *"));
    const cut = this.el.querySelector<HTMLElement>(".reveal-cutout")!;
    gsap.set(cut, { xPercent: -50, yPercent: -50, rotate: opts.tilt, scale: 0.92 });
    gsap.to(eyebrow, { opacity: 1, duration: 0.5, delay: 0.4, ease: "power1.out" });
    gsap.to(title, { opacity: 1, duration: 0.5, delay: 0.7, ease: "power1.out" });
    gsap.to(cut, { opacity: 1, duration: 0.55, delay: 0.9, ease: "power1.out" });
    gsap.to(cut, { scale: 1, duration: 0.8, delay: 0.9, ease: ease.pop });
  }

  async hide() {
    await gsap.to(this.el.children, { opacity: 0, duration: 0.4, ease: "power1.in" });
    this.el.innerHTML = "";
  }

  destroy() { gsap.killTweensOf(this.el); this.el.remove(); }
}
