import type { IconName } from "../data/manifest";
import { h } from "./dom";
import { icon } from "./icons";

// Paper tile (spec C2): white paper, its own rest rotation, corner peel on
// hover, entrance from the nearest screen edge. The animation runs on the
// outer button through --rest, the peel lives on the inner body.

export interface TileOptions {
  icon?: IconName;
  label?: string;
  aria: string;
  rest?: number;
  from?: "top" | "bottom" | "left" | "right";
  className?: string;
}

const ENTER = { top: ["0", "-160%"], bottom: ["0", "160%"], left: ["-160%", "0"], right: ["160%", "0"] };

export class Tile {
  el: HTMLButtonElement;
  private body: HTMLElement;
  private labelEl?: HTMLElement;
  private iconEl?: HTMLElement;

  constructor(parent: HTMLElement, opts: TileOptions) {
    this.el = h("button", `tile ${opts.className ?? ""}`);
    this.el.type = "button";
    this.el.setAttribute("aria-label", opts.aria);
    const [x, y] = ENTER[opts.from ?? "top"];
    this.el.style.setProperty("--rest", `${opts.rest ?? 0}deg`);
    this.el.style.setProperty("--enter-x", x);
    this.el.style.setProperty("--enter-y", y);
    this.body = h("span", "tile-body");
    if (opts.icon) { this.iconEl = h("span", "tile-icon", icon(opts.icon)); this.body.appendChild(this.iconEl); }
    if (opts.label !== undefined) { this.labelEl = h("span", "tile-label", opts.label); this.body.appendChild(this.labelEl); }
    this.body.appendChild(h("span", "tile-peel"));
    this.el.appendChild(this.body);
    this.el.dataset.state = "out";
    parent.appendChild(this.el);
  }

  set label(text: string) { if (this.labelEl) this.labelEl.textContent = text; }
  set iconName(name: IconName) { if (this.iconEl) this.iconEl.innerHTML = icon(name); }
  set color(value: string) { this.body.style.background = value; this.body.style.color = value ? "#fff" : ""; }

  show(delay = 0) {
    this.el.style.animationDelay = `${delay}s`;
    this.el.dataset.state = "in";
    this.el.tabIndex = 0;
  }

  hide() {
    this.el.style.animationDelay = "0s";
    this.el.dataset.state = "out";
    this.el.tabIndex = -1;
  }

  get shown() { return this.el.dataset.state === "in"; }

  onClick(fn: () => void) { this.el.addEventListener("click", fn); return this; }

  destroy() { this.el.remove(); }
}
