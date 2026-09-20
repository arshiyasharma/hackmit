import Lenis from "lenis";
import { sound } from "../audio/sound";
import { asset, manifest } from "../data/manifest";
import { exists } from "../gl/placeholder";
import { ease, gsap, reducedMotion } from "../motion";
import { checker, cloud, HACK, ribbon, sparkle, star, valance } from "./decor";
import { h, rich } from "./dom";
import { icon } from "./icons";
import { Tile } from "./Tile";
import type { Ctx } from "./types";

// Chapter IV, "About us": the hackathon room, dressed in HackMIT's own flat
// vector language — ribbons, clouds, sparkles, a scalloped tent valance — in
// their palette with the deep navy swapped for the landing's blue.
//
// The hero borrows the depth wall from the reference site: photographs start
// far behind the screen and travel toward the viewer, so scrolling walks you
// through the pictures rather than past them.

/** Where each hero photo sits: x and y in vw/vh, z in px behind the screen. */
const FIELD = [
  // Perspective pulls distant cards toward the vanishing point, so the far ones
  // are thrown much wider to keep the middle of the screen clear for the title.
  { x: -62, y: -44, z: -2600, s: 1.0 }, { x: 58, y: -50, z: -2300, s: 0.8 },
  { x: -50, y: 46, z: -2050, s: 0.9 }, { x: 54, y: 44, z: -1800, s: 1.1 },
  { x: -66, y: 6, z: -1560, s: 0.7 }, { x: 62, y: -10, z: -1350, s: 0.85 },
  { x: -30, y: -52, z: -1150, s: 0.75 }, { x: 34, y: 50, z: -980, s: 0.95 },
  { x: -56, y: -22, z: -820, s: 0.65 }, { x: 52, y: 24, z: -700, s: 0.8 },
  { x: -34, y: 44, z: -580, s: 0.7 }, { x: 38, y: -46, z: -470, s: 0.9 },
  { x: -58, y: 30, z: -370, s: 0.6 }, { x: 56, y: -30, z: -290, s: 0.7 },
  { x: -14, y: 52, z: -210, s: 0.8 }, { x: 16, y: -54, z: -150, s: 0.65 },
];

/** How far the field travels toward the viewer across the hero's scroll. */
const TRAVEL = 2700;

export class AboutPage {
  private root = h("section", "about");
  private flood = h("div", "flood about-flood");
  private scroller!: HTMLElement;
  private content!: HTMLElement;
  private close!: Tile;
  private lenis?: Lenis;
  private raf?: (t: number) => void;
  private open$?: Promise<void>;
  private done?: () => void;
  private reduced = reducedMotion();
  private built = false;

  constructor(private ctx: Ctx) {
    this.root.hidden = true;
    ctx.ui.append(this.flood, this.root);
  }

  // ---- markup ---------------------------------------------------------------

  private build() {
    if (this.built) return;
    this.built = true;
    const s = manifest.strings.about;

    const photos = FIELD.map((p, i) => `
      <figure class="about-photo" data-i="${i}" style="--x:${p.x}vw; --y:${p.y}vh; --z:${p.z}px; --s:${p.s}">
        <span class="about-photo-slot">${i + 1}</span>
      </figure>`).join("");

    const galleryTiles = Array.from({ length: 9 }, (_, i) => `
      <figure class="about-tile" style="--rot:${[-3, 2, -1.5, 3, -2, 1.5, -2.5, 2.5, -1][i]}deg">
        <span>photo ${i + 1}</span>
      </figure>`).join("");

    this.root.innerHTML = `
      <div class="about-scroll">
        <div class="about-content">
          <header class="about-hero">
            <div class="about-sky" aria-hidden="true">
              ${ribbon([HACK.coral, HACK.peach, HACK.butter, HACK.sage, HACK.lavender], 0.9)}
              <i class="about-cloud c1">${cloud(HACK.lavender, 300)}</i>
              <i class="about-cloud c2">${cloud(HACK.peach, 240)}</i>
              <i class="about-cloud c3">${cloud(HACK.sky, 200)}</i>
              <i class="about-spark s1">${sparkle(HACK.butter, 30)}</i>
              <i class="about-spark s2">${sparkle("var(--highlight)", 20)}</i>
              <i class="about-spark s3">${star(HACK.coral, 22)}</i>
              <i class="about-spark s4">${sparkle(HACK.sage, 16)}</i>
            </div>
            <div class="about-field">${photos}</div>
            <div class="about-title">
              <p class="about-eyebrow">${s.eyebrow}</p>
              <h1>${s.title}</h1>
              <p class="about-lede">${rich(s.lede)}</p>
              <p class="about-scrollhint">${s.scrollHint}</p>
            </div>
          </header>

          <div class="about-band">${checker(HACK.sage, HACK.butter, 16)}</div>

          <section class="about-section" data-tone="problem">
            <h2>${s.problem.title}</h2>
            <p class="about-note">${rich(s.problem.body)}</p>
            <p class="about-ph">${s.placeholder}</p>
          </section>

          <section class="about-section" data-tone="why">
            <h2>${s.why.title}</h2>
            <p class="about-note">${rich(s.why.body)}</p>
            <p class="about-ph">${s.placeholder}</p>
          </section>

          <section class="about-section" data-tone="solves">
            <h2>${s.solves.title}</h2>
            <ul class="about-list">${s.solves.points.map((p) => `<li>${rich(p)}</li>`).join("")}</ul>
            <p class="about-ph">${s.placeholder}</p>
          </section>

          <section class="about-section about-journey">
            <h2>${s.journey.title}</h2>
            <ol class="about-timeline">
              ${s.journey.beats.map((b, i) => `
                <li style="--rot:${i % 2 ? 1.2 : -1.2}deg">
                  <span class="about-when">${b.when}</span>
                  <span class="about-what">${b.what}</span>
                </li>`).join("")}
            </ol>
            <p class="about-ph">${s.placeholder}</p>
          </section>

          <section class="about-section about-gallery">
            <h2>${s.gallery.title}</h2>
            <p class="about-note">${s.gallery.body}</p>
            <div class="about-collage">${galleryTiles}</div>
          </section>

          <section class="about-section about-demo">
            <h2>${s.demo.title}</h2>
            <div class="about-video"><div class="about-video-slot">${icon("play", 34)}<span>${s.demo.slot}</span></div></div>
          </section>

          <footer class="about-thanks">
            ${valance(HACK.coral)}
            <p>${s.thanks}</p>
          </footer>
        </div>
      </div>`;

    this.scroller = this.root.querySelector(".about-scroll")!;
    this.content = this.root.querySelector(".about-content")!;
    this.close = new Tile(this.root, {
      icon: "close", aria: s.closeAria, rest: 2, from: "top", className: "page-close about-close",
    });
    this.close.onClick(() => this.leave());
    this.root.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") this.leave(); });
    void this.fillVideo();
  }

  /** Use the demo clip when it is there; keep the marked slot when it is not. */
  private async fillVideo() {
    if (!(await exists(manifest.demoVideo))) return;
    const slot = this.root.querySelector(".about-video");
    if (!slot) return;
    slot.innerHTML = `<video src="${asset(manifest.demoVideo)}" controls playsinline preload="none"
      poster="${asset(manifest.rooms.R3)}"></video>`;
  }

  // ---- the depth field ------------------------------------------------------

  /** Drive the photo field from scroll: everything walks toward the viewer. */
  private driveField(progress: number) {
    const photos = this.root.querySelectorAll<HTMLElement>(".about-photo");
    photos.forEach((el, i) => {
      const base = FIELD[i].z;
      const z = base + progress * TRAVEL;
      // fade in out of the haze, then out again as it passes the camera
      const near = gsap.utils.clamp(0, 1, (z + 2600) / 900);
      const past = gsap.utils.clamp(0, 1, (120 - z) / 380);
      el.style.setProperty("--z", `${z}px`);
      el.style.opacity = String(Math.min(near, past));
    });
  }

  // ---- open and close -------------------------------------------------------

  async open(opts: { onCovered?: () => void } = {}) {
    if (this.open$) return this.open$;
    this.build();
    this.open$ = new Promise<void>((resolve) => { this.done = resolve; });

    // flood the screen in the field colour, reset the stage behind it, slide in
    gsap.set(this.flood, { opacity: 0, display: "block" });
    await gsap.to(this.flood, { opacity: 1, duration: 0.35, ease: "power1.inOut" });
    opts.onCovered?.();
    this.root.hidden = false;
    void sound.sfx("paperSlide", 0.5);

    this.driveField(0);
    if (this.reduced) {
      gsap.fromTo(this.root, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" });
    } else {
      gsap.fromTo(this.root, { xPercent: 106, rotate: -4 }, { xPercent: 0, rotate: 0, duration: 1.2, ease: ease.slide });
    }
    gsap.to(this.flood, { opacity: 0, duration: 0.5, delay: 0.5, ease: "power1.inOut", onComplete: () => gsap.set(this.flood, { display: "none" }) });

    this.startScroll();
    this.close.show(0.5);
    this.close.el.focus({ preventScroll: true });
    return this.open$;
  }

  private startScroll() {
    if (this.reduced) {
      this.scroller.style.overflowY = "auto";
      this.scroller.addEventListener("scroll", this.onNativeScroll);
      return;
    }
    this.lenis = new Lenis({ wrapper: this.scroller, content: this.content, lerp: 0.12 });
    this.lenis.on("scroll", ({ scroll }: { scroll: number }) => {
      this.driveField(gsap.utils.clamp(0, 1, scroll / Math.max(1, window.innerHeight * 0.9)));
    });
    this.raf = (t: number) => this.lenis?.raf(t * 1000);
    gsap.ticker.add(this.raf);
  }

  private onNativeScroll = () => {
    this.driveField(gsap.utils.clamp(0, 1, this.scroller.scrollTop / Math.max(1, window.innerHeight * 0.9)));
  };

  private async leave() {
    if (!this.done) return;
    const finish = this.done;
    this.done = undefined;
    void sound.sfx("paperTear", 0.5);
    this.close.hide();
    gsap.set(this.flood, { opacity: 0, display: "block" });
    gsap.to(this.flood, { opacity: 1, duration: 0.35, ease: "power1.inOut" });
    if (this.reduced) await gsap.to(this.root, { opacity: 0, duration: 0.4 });
    else await gsap.to(this.root, { xPercent: 106, rotate: -4, duration: 1.0, ease: ease.slide });
    this.root.hidden = true;
    this.stopScroll();
    await gsap.to(this.flood, { opacity: 0, duration: 0.35, ease: "power1.inOut" });
    gsap.set(this.flood, { display: "none" });
    this.open$ = undefined;
    finish();
  }

  private stopScroll() {
    if (this.raf) { gsap.ticker.remove(this.raf); this.raf = undefined; }
    this.lenis?.destroy();
    this.lenis = undefined;
    this.scroller?.removeEventListener("scroll", this.onNativeScroll);
    if (this.scroller) this.scroller.scrollTop = 0;
  }

  destroy() {
    this.stopScroll();
    gsap.killTweensOf([this.root, this.flood]);
    this.close?.destroy();
    this.root.remove();
    this.flood.remove();
  }
}
