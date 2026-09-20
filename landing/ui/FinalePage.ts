import { asset, manifest } from "../data/manifest";
import { exists } from "../gl/placeholder";
import { ease, gsap, reducedMotion } from "../motion";
import { h } from "./dom";
import { PaperPage, photoCard, pic, sofaPhoto, tapeStrip } from "./BasketPage";
import { Tile } from "./Tile";
import type { Ctx } from "./types";

// Finale page (spec A15, B4, M8): a second paper page. Section one restates the
// asks among scattered photos, section two holds the taped demo poster, the two
// tiles, and the stamp strip. No card-network logo is drawn anywhere (B6).

// one rest rotation per corner spot n1..n4; the demo only fills the first two
const PHOTO_ROT = [-8, 7, 6, -8];
const STAMP_ROT = [-5, 2.5, -3];

export class FinalePage extends PaperPage {
  private asks: HTMLElement[] = [];
  private photos = h("div", "finale-photos");
  private demo!: Tile;
  private share!: Tile;
  private play!: Tile;
  private hasVideo = false;
  private askWatch?: IntersectionObserver;
  private overlay?: { el: HTMLElement; video: HTMLVideoElement; close: Tile };
  private relabel?: gsap.core.Tween;

  /** `onDemo` walks the shopper to the product's room; without it the button
   *  falls back to the standalone app. */
  constructor(ctx: Ctx, private onDemo?: () => void) {
    super(ctx, "finale", manifest.strings.finale.title, "Close and return to the room");
    this.build();
    // the play tile only exists for a real file, so look before the page ever opens
    void exists(manifest.demoVideo).then((ok) => {
      this.hasVideo = ok;
      if (ok && this.closeTile.shown) this.play.show();
    });
  }

  /** Opens the page. onCovered fires once the flood hides the stage. Resolves when the page has closed. */
  open(opts: { onCovered?: () => void } = {}): Promise<void> {
    return this.begin(opts.onCovered);
  }

  private build() {
    const s = manifest.strings.finale;

    const one = h("section", "finale-one");
    const title = h("h2", "finale-title", `<span class="page-boil"></span>`);
    title.firstElementChild!.textContent = s.title;
    const list = h("ol", "finale-asks");
    manifest.pieces.forEach((piece, i) => {
      const li = h("li", "finale-ask");
      li.style.setProperty("--i", String(i));
      const fill = h("span", "finale-ask-fill");
      fill.textContent = `${piece.slot}. ${piece.ask}`;
      li.appendChild(fill);
      this.asks.push(li);
      list.appendChild(li);
    });
    one.append(title, list, this.photos);

    const two = h("section", "finale-two");
    const poster = h("figure", "finale-poster");
    poster.append(pic(manifest.rooms.R3, "finale-poster-img", "The furnished room"), tapeStrip(1, -3));
    this.play = new Tile(poster, { icon: "play", aria: "Play the demo video", rest: -3, from: "bottom", className: "finale-play" });
    this.play.hide();
    this.play.onClick(() => this.openVideo());

    const side = h("div", "finale-side");
    const sectionTitle = h("h3", "finale-section-title", `<span class="page-boil"></span>`);
    sectionTitle.firstElementChild!.textContent = s.sectionTitle;
    const paragraph = h("p", "finale-paragraph");
    paragraph.textContent = s.paragraph;
    const tiles = h("div", "finale-tiles");
    this.demo = new Tile(tiles, { icon: "bag", label: s.demo, aria: s.demo, rest: -1.5, from: "right", className: "finale-cta" });
    this.demo.color = "var(--highlight)";
    this.demo.onClick(() => {
      if (!this.onDemo) { window.location.href = manifest.demoUrl; return; }
      if (this.leaving) return;
      void this.close();
      this.onDemo();
    });
    this.share = new Tile(tiles, { icon: "share", label: s.share, aria: s.share, rest: 1.5, from: "right", className: "finale-cta" });
    this.share.onClick(() => void this.copyLink());
    this.demo.hide();
    this.share.hide();
    side.append(sectionTitle, paragraph, tiles);
    two.append(poster, side);

    const stamps = h("ul", "finale-stamps");
    s.stamps.forEach((text, i) => {
      const li = h("li", `finale-stamp ${i === 0 ? "round" : ""}`, `<span></span>`);
      li.firstElementChild!.textContent = text;
      li.style.setProperty("--rot", `${STAMP_ROT[i % STAMP_ROT.length]}deg`);
      stamps.appendChild(li);
    });

    this.content.append(one, two, stamps);
  }

  protected prepare() {
    this.asks.forEach((li) => li.classList.remove("on"));
    // rebuilt on every open because the sofa photo follows the chosen fabric
    this.photos.innerHTML = "";
    manifest.pieces.forEach((piece, i) => {
      const path = piece.id === "sofa" ? sofaPhoto().path : piece.photo;
      const card = photoCard(path, piece.name, PHOTO_ROT[i % PHOTO_ROT.length]);
      card.classList.add("finale-photo", `n${i + 1}`);
      this.photos.appendChild(card);
    });
    const swatch = pic(manifest.cutouts.swatch, "finale-swatch");
    this.photos.appendChild(swatch);
  }

  protected landed() {
    this.demo.show(0.15);
    this.share.show(0.21);
    if (this.hasVideo) this.play.show(0.3);
    // each line inks in once it is comfortably inside the page
    this.askWatch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("on");
        this.askWatch?.unobserve(entry.target);
      }
    }, { root: this.scroller, rootMargin: "0px 0px -14% 0px", threshold: 0.9 });
    this.asks.forEach((li) => this.askWatch!.observe(li));
  }

  protected left() {
    this.askWatch?.disconnect();
    this.askWatch = undefined;
    this.closeVideo(true);
    this.demo.hide();
    this.share.hide();
    this.play.hide();
    this.relabel?.kill();
    this.setShareLabel(manifest.strings.finale.share);
  }

  protected onEscape() {
    if (!this.overlay) return false;
    this.closeVideo();
    return true;
  }

  // ---- share ------------------------------------------------------------------

  private setShareLabel(text: string) {
    this.share.label = text;
    this.share.el.setAttribute("aria-label", text);
  }

  private async copyLink() {
    const url = window.location.href;
    // a phone has a share sheet and no visible clipboard, so offer it there. Only
    // on a coarse pointer, so the desktop keeps the copy-and-relabel it had.
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: manifest.strings.finale.title, url });
      } catch { /* dismissed or refused: leave the label alone */ }
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = this.legacyCopy(url);
    }
    if (!copied || this.leaving) return;
    this.setShareLabel(manifest.strings.finale.copied);
    this.relabel?.kill();
    this.relabel = gsap.delayedCall(2, () => this.setShareLabel(manifest.strings.finale.share));
  }

  /** Insecure contexts have no async clipboard, so fall back to a selected off-screen field. */
  private legacyCopy(text: string) {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.cssText = "position:fixed;left:-999px;top:0;opacity:0";
    // inside the page root, or the focus trap would steal the selection
    this.root.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    field.remove();
    this.share.el.focus({ preventScroll: true });
    return ok;
  }

  // ---- video overlay ------------------------------------------------------------

  private openVideo() {
    if (this.overlay || this.leaving) return;
    const el = h("div", "finale-video");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Demo video");
    const video = h("video", "finale-video-player");
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.src = asset(manifest.demoVideo);
    const close = new Tile(el, { icon: "close", aria: "Close the video", rest: 2, from: "top", className: "finale-video-close" });
    close.onClick(() => this.closeVideo());
    // a click on the dark backdrop closes too, a click on the player does not
    el.addEventListener("click", (e) => { if (e.target === el) this.closeVideo(); });
    el.appendChild(video);
    this.root.appendChild(el);
    this.overlay = { el, video, close };
    this.lenis?.stop();
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: ease.out });
    if (!reducedMotion()) gsap.fromTo(video, { scale: 0.94 }, { scale: 1, duration: 0.5, ease: ease.pop });
    close.show(0.1);
    close.el.focus({ preventScroll: true });
    void video.play().catch(() => { /* autoplay refused: the controls are right there */ });
  }

  private closeVideo(instant = false) {
    const overlay = this.overlay;
    if (!overlay) return;
    this.overlay = undefined;
    overlay.video.pause();
    overlay.close.hide();
    this.lenis?.start();
    const remove = () => { overlay.close.destroy(); overlay.el.remove(); };
    gsap.killTweensOf([overlay.el, overlay.video]);
    if (instant) { remove(); return; }
    gsap.to(overlay.el, { opacity: 0, duration: 0.3, ease: ease.out, onComplete: remove });
    this.play.el.focus({ preventScroll: true });
  }

  destroy() {
    this.left();
    this.demo.destroy();
    this.share.destroy();
    this.play.destroy();
    super.destroy();
  }
}
