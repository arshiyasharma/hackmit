import { manifest, type ChapterIndex } from "../data/manifest";
import type { World } from "../gl/World";
import { h } from "./dom";
import { icon } from "./icons";

// Chapter eyebrow, room name, and the entry tile for one window (spec A8, A9).
// They are projected with their facade module every frame, so they travel with
// the window during a truck while the arrows and HUD stay put.
export class ChapterLabel {
  label: HTMLElement;
  entry: HTMLButtonElement;
  /** notch and home-indicator insets, re-read only when the viewport resizes */
  private safeTop = 0;
  private safeBottom = 0;
  private lastH = -1;

  constructor(parent: HTMLElement, public chapter: ChapterIndex, onEnter: (c: ChapterIndex) => void) {
    const c = manifest.chapters[chapter];
    this.label = h("div", "chapter-label", `<span class="eyebrow">Chapter ${c.numeral}</span><span class="chapter-name">${c.name}</span>`);
    this.entry = h("button", "tile chapter-entry");
    this.entry.type = "button";
    this.entry.setAttribute("aria-label", `${manifest.strings.hud.enterRoom}: chapter ${c.numeral}, ${c.name}`);
    this.entry.innerHTML = `<span class="tile-body"><span class="tile-icon">${icon("door")}</span><span class="tile-label">${manifest.strings.hud.enterRoom}</span><span class="tile-peel"></span></span>`;
    this.entry.addEventListener("click", () => onEnter(chapter));
    parent.append(this.label, this.entry);
    this.setVisible(false);
  }

  setVisible(on: boolean) {
    this.label.classList.toggle("on", on);
    this.entry.classList.toggle("on", on);
    this.entry.tabIndex = on ? 0 : -1;
  }

  /** Read the safe-area tokens off .sense. Rotating a phone is the only thing
   *  that changes them, and that always changes the stage height with it. */
  private readInsets() {
    const style = getComputedStyle(this.label);
    this.safeTop = parseFloat(style.getPropertyValue("--sat")) || 0;
    this.safeBottom = parseFloat(style.getPropertyValue("--sab")) || 0;
  }

  place(world: World) {
    if (world.H !== this.lastH) { this.lastH = world.H; this.readInsets(); }
    const r = manifest.windowRect;
    const top = world.projectModule(0.5, r.y - 0.2, this.chapter);
    const bottom = world.projectModule(0.5, r.y + r.h + 0.115, this.chapter);
    // labels follow the window sideways but stay level, inside the screen, and
    // out from under the notch above and the home indicator below
    const ty = Math.max(28 + this.safeTop, Math.min(world.H * 0.2, top.y));
    const by = Math.min(world.H - 44 - this.safeBottom, Math.max(world.H * 0.8, bottom.y));
    this.label.style.transform = `translate3d(${top.x.toFixed(1)}px, ${ty.toFixed(1)}px, 0) translate(-50%, 0)`;
    this.entry.style.transform = `translate3d(${bottom.x.toFixed(1)}px, ${by.toFixed(1)}px, 0) translate(-50%, -50%) rotate(-1.5deg)`;
  }

  destroy() { this.label.remove(); this.entry.remove(); }
}
