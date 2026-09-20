import type { Hotspot as HotspotData } from "../data/manifest";
import { h } from "./dom";
import { blob, icon } from "./icons";

// Hotspot (spec A4, C2): a DOM button repositioned every frame from projected
// coordinates. The outer button only ever gets the position transform; states
// and the shake run on inner wrappers so they cannot overwrite it.

export type HotspotState = "hidden" | "idle" | "loading" | "visited" | "locked";

export class Hotspot {
  el: HTMLButtonElement;
  private inner: HTMLElement;
  state: HotspotState = "hidden";

  constructor(parent: HTMLElement, public data: HotspotData) {
    this.el = h("button", "hotspot");
    this.el.type = "button";
    this.el.setAttribute("aria-label", data.label);
    this.inner = h("span", "hotspot-in", `
      <span class="hotspot-ring"></span><span class="hotspot-ring late"></span>
      <span class="hotspot-blob">${blob}</span>
      <span class="hotspot-icon">${icon(data.icon, 30)}</span>
      <span class="hotspot-spin"></span>
      <span class="hotspot-check">${icon("check", 14)}</span>
      <span class="hotspot-lock">${icon("lock", 12)}</span>`);
    this.el.appendChild(this.inner);
    this.set("hidden");
    parent.appendChild(this.el);
  }

  set(state: HotspotState) {
    this.state = state;
    this.el.dataset.state = state;
    this.el.tabIndex = state === "hidden" ? -1 : 0;
    this.el.setAttribute("aria-disabled", String(state === "locked"));
  }

  place(x: number, y: number) {
    this.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  shake() {
    this.inner.classList.remove("shake");
    void this.inner.offsetWidth;
    this.inner.classList.add("shake");
  }

  destroy() { this.el.remove(); }
}
