import { h } from "./dom";
import { icon } from "./icons";
import type { IconName } from "../data/manifest";

// Progress cursor (spec C2): a 46px white dot that follows the pointer with a
// 0.12 lerp and draws progress as a ring. The same ring markup is reused on
// the phone screen in the approve scene.

const R = 21;
const LEN = 2 * Math.PI * R;

export function ringMarkup(size = 46) {
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 46 46" aria-hidden="true">
    <circle cx="23" cy="23" r="${R}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
    <circle class="ring-value" cx="23" cy="23" r="${R}" fill="none" stroke="var(--highlight)" stroke-width="2" stroke-linecap="round"
      stroke-dasharray="${LEN.toFixed(2)}" stroke-dashoffset="${LEN.toFixed(2)}" transform="rotate(-90 23 23)"/></svg>`;
}

export function setRing(root: Element, progress: number) {
  const value = root.querySelector<SVGCircleElement>(".ring-value");
  if (value) value.style.strokeDashoffset = String(LEN * (1 - Math.min(1, Math.max(0, progress))));
}

export class ProgressCursor {
  el = h("div", "pcursor");
  x = 0; y = 0;
  // touch fires nothing until a finger lands, so an un-seeded cursor would show
  // up in the top-left corner on a phone: start it in the middle of the screen
  private tx = window.innerWidth / 2; private ty = window.innerHeight / 2;
  private active = false;
  private onMove = (e: PointerEvent) => { this.tx = e.clientX; this.ty = e.clientY; if (!this.active) { this.x = this.tx; this.y = this.ty; } };

  constructor(private ui: HTMLElement) {
    this.el.setAttribute("aria-hidden", "true");
    ui.appendChild(this.el);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerdown", this.onMove);
  }

  show(iconName: IconName) {
    this.el.innerHTML = `<span class="pcursor-dot">${icon(iconName, 22)}</span>${ringMarkup()}`;
    this.x = this.tx; this.y = this.ty;
    this.active = true;
    this.el.classList.add("on");
    this.ui.classList.add("no-cursor");
    this.progress = 0;
  }

  hide() {
    this.active = false;
    this.el.classList.remove("on");
    this.ui.classList.remove("no-cursor");
  }

  set progress(p: number) { setRing(this.el, p); }

  /** Call every frame. */
  update(dt: number) {
    if (!this.active) return;
    const k = 1 - Math.pow(1 - 0.12, dt * 60);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.el.style.transform = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0)`;
  }

  destroy() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerdown", this.onMove);
    this.el.remove();
  }
}
