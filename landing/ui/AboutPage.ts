import { sound } from "../audio/sound";
import { asset, manifest } from "../data/manifest";
import { aboutChapters, aboutHero, heroTextStyle } from "../data/aboutHero";
import { gsap, reducedMotion } from "../motion";
import { h } from "./dom";
import { icon } from "./icons";
import type { Ctx } from "./types";

/** An ordinary, scrollable story inside the landing's fourth room. */
export class AboutPage {
  private root = h("section", "about");
  private flood = h("div", "flood about-flood");
  private close!: HTMLButtonElement;
  private open$?: Promise<void>;
  private done?: () => void;
  private built = false;
  private dead = false;
  private previousFocus?: HTMLElement;
  private observer?: IntersectionObserver;
  private viewportObserver?: MutationObserver;
  private viewport?: { element: HTMLMetaElement; original: string; enabled: string };
  private siblings: { element: HTMLElement; inert: boolean }[] = [];

  constructor(private ctx: Ctx) {
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-labelledby", "about-title");
    // The 3D room has its own gestures; this document owns its scrolling.
    this.root.addEventListener("pointerdown", (event) => event.stopPropagation());
    ctx.ui.append(this.flood, this.root);
  }

  private build() {
    if (this.built) return;
    this.built = true;
    const s = manifest.strings.about;
    const safe = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    this.root.innerHTML = `
      <header class="about-header">
        <a class="about-wordmark" href="#about-top" data-scroll="about-top" aria-label="PIXX-AR story, back to top">PIXX-AR</a>
        <nav class="about-nav" aria-label="Our story sections">
          <a href="#about-problem" data-scroll="about-problem">The Problem</a>
          <a href="#about-tracks" data-scroll="about-tracks">Tracks</a>
          <a href="#about-weekend" data-scroll="about-weekend">The weekend</a>
          <a href="#about-gallery" data-scroll="about-gallery">Fun Moments</a>
        </nav>
        <button type="button" class="about-back" aria-label="${s.closeAria}">${icon("arrowLeft", 17)}<span>The rooms</span></button>
      </header>
      <div class="about-sheet">
        <section class="about-hero" id="about-top" aria-labelledby="about-title" style="background:${aboutHero.background};color:${aboutHero.ink}">
          <div class="about-hero-art" aria-hidden="true">${aboutHero.art.map((art) => `<img class="about-hero-${art.name}" src="${asset(art.src)}" alt="" width="${Math.round(art.width)}" height="${Math.round(art.height)}" style="left:${art.x / aboutHero.width * 100}%;top:${art.y / aboutHero.height * 100}%;width:${art.width / aboutHero.width * 100}%;height:${art.height / aboutHero.height * 100}%" decoding="async" fetchpriority="high" />`).join("")}</div>
          <p class="about-hero-eyebrow" style="${heroTextStyle(aboutHero.eyebrow)}">${aboutHero.eyebrow.lines.join(" ")}</p>
          <h1 class="about-hero-title" id="about-title" style="${heroTextStyle(aboutHero.title)}">${aboutHero.title.lines.map((line) => `<span>${line}</span>`).join(" ")}</h1>
          <p class="about-hero-lede" style="${heroTextStyle(aboutHero.lede)}">${aboutHero.lede.lines.map((line) => `<span>${line}</span>`).join(" ")}</p>
          <p class="about-hero-note" style="${heroTextStyle(aboutHero.note)}">${aboutHero.note.lines.join(" ")}</p>
          <a class="about-primary about-hero-cta" href="#about-problem" data-scroll="about-problem" style="left:${aboutHero.cta.x / aboutHero.width * 100}%;top:${aboutHero.cta.y / aboutHero.height * 100}%;width:${aboutHero.cta.width / aboutHero.width * 100}%;height:${aboutHero.cta.height / aboutHero.height * 100}%;font-size:${aboutHero.cta.size / aboutHero.width * 100}cqw">${aboutHero.cta.label}</a>
          <p class="about-hero-event" style="${heroTextStyle(aboutHero.event)}">${aboutHero.event.lines.join(" ")}</p>
        </section>
        <nav class="about-chapters" aria-label="Explore our HackMIT story">${aboutChapters.map((chapter) => `<a class="about-chapter" href="#${chapter.target}" data-scroll="${chapter.target}"><img src="${asset(`about/hackmit/${chapter.art}.png`)}" alt="" width="72" height="96" loading="lazy" decoding="async" /><span><strong>${chapter.title}</strong><span>${chapter.note}</span></span>${icon("arrowRight", 18)}</a>`).join("")}</nav>
        <section class="about-problem about-section" id="about-problem" aria-labelledby="about-question">
          <div class="about-section-label">01 / THE PROBLEM</div>
          <div class="about-problem-intro">
            <h2 id="about-question">${s.question}</h2>
            <div><p class="about-section-lede">${s.problem}</p><p class="about-secondary-copy">The goal: less guesswork, more “that belongs here.”</p></div>
          </div>
          <div class="about-product-intro"><div><p class="about-eyebrow">WHAT WE BUILT</p><h3>Meet PIXX-AR.</h3></div><div><p>${s.product}</p><a href="/landing?product" class="about-text-link">Explore PIXX-AR</a></div></div>
          <ol class="about-how">${s.steps.map((step, i) => `<li><span class="about-step-number">0${i + 1}</span><h4>${step.title}</h4><p>${step.body}</p></li>`).join("")}</ol>
        </section>
        <section class="about-tracks about-section" id="about-tracks" aria-labelledby="about-tracks-title">
          <div class="about-section-label">02 / THE TRACKS</div>
          <div class="about-section-heading"><h2 id="about-tracks-title">${s.tracksTitle}</h2><p>${s.tracksNote}</p></div>
          <div class="about-track-grid">${s.tracks.map((track) => `<article class="about-track"><div class="about-track-brand">${track.logo ? `<img src="${asset(track.logo)}" alt="${safe(track.sponsor)}" width="960" height="307" loading="lazy" decoding="async" />` : `<span>${safe(track.sponsor)}</span>`}</div><h3>${safe(track.title)}</h3><p>${safe(track.body)}</p></article>`).join("")}</div>
          <p class="about-prototype-note">Built as a hackathon prototype. Checkout is a demo; no real purchases are made.</p>
        </section>
        <section class="about-journey about-section" id="about-weekend" aria-labelledby="about-journey-title">
          <img class="about-weekend-art" src="${asset("about/hackmit/rabbit-portal.png")}" alt="" width="710" height="756" loading="lazy" decoding="async" /><div class="about-section-label">03 / THE WEEKEND</div>
          <h2 id="about-journey-title">${s.journeyTitle}</h2>
          <ol class="about-journey-grid">${s.journey.map((entry) => `<li><h3>${entry.title}</h3><p>${entry.body}</p></li>`).join("")}</ol>
        </section>
        <section class="about-gallery about-section" id="about-gallery" aria-labelledby="about-gallery-title">
          <div class="about-section-label">04 / THE MEMORIES</div>
          <div class="about-section-heading"><h2 id="about-gallery-title">${s.galleryTitle}</h2><p>${s.galleryNote}</p></div>
          <div class="about-gallery-grid">${s.gallery.map((photo, i) => `<figure class="about-photo">${photo.src ? `<a class="about-photo-image" href="${safe(asset(photo.src))}" target="_blank" rel="noopener noreferrer" aria-label="Open photo: ${safe(photo.title)}"><img src="${safe(asset(photo.src))}" alt="${safe(photo.alt || photo.title)}" width="600" height="450" loading="lazy" decoding="async" /></a>` : `<div class="about-photo-placeholder"><span>${s.photoPlaceholder}</span></div>`}<figcaption><span>${safe(photo.title)}</span><span class="about-photo-number">${String(i + 1).padStart(2, "0")}</span></figcaption></figure>`).join("")}</div>
        </section>
        <section class="about-thanks" aria-labelledby="about-thanks-title"><div><h2 id="about-thanks-title">Thank you for being part of it.</h2><p>To HackMIT, our judges, mentors, and everyone we met along the way.</p></div><a href="/landing?product" class="about-primary">Explore PIXX-AR</a></section>
        <footer class="about-footer"><a href="#about-top" data-scroll="about-top" class="about-wordmark">PIXX-AR</a><p>${s.signature}<span class="about-art-credit">Illustrations from HackMIT, supplied by our team.</span></p><a href="https://hackmit.org/" target="_blank" rel="noopener noreferrer">HackMIT 2026</a></footer>
      </div>`;
    this.close = this.root.querySelector<HTMLButtonElement>(".about-back")!;
    this.close.addEventListener("click", () => void this.leave());
    this.root.querySelectorAll<HTMLAnchorElement>("[data-scroll]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = this.root.querySelector<HTMLElement>(`#${link.dataset.scroll}`);
        if (!target) return;
        const headerHeight = this.root.querySelector<HTMLElement>(".about-header")!.offsetHeight;
        const top = this.root.scrollTop + target.getBoundingClientRect().top - this.root.getBoundingClientRect().top - headerHeight;
        this.root.scrollTo({ top, behavior: reducedMotion() ? "instant" : "smooth" });
        // Keyboard users arrive at the section too, without a second scroll.
        const heading = target.querySelector<HTMLElement>("h1, h2");
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      });
    });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void this.leave(); }
      if (event.key !== "Tab") return;
      const targets = [...this.root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")].filter((el) => el.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.root.querySelectorAll(".about-nav a").forEach((link) => {
          if ((link as HTMLElement).dataset.scroll === entry.target.id) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }
    }, { root: this.root, rootMargin: "-18% 0px -60% 0px", threshold: 0 });
    this.root.querySelectorAll("#about-top, #about-problem, #about-tracks, #about-weekend, #about-gallery").forEach((section) => this.observer!.observe(section));
  }

  async open(opts: { onCovered?: () => void } = {}) {
    if (this.dead) return;
    if (this.open$) return this.open$;
    this.build();
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.open$ = new Promise<void>((resolve) => { this.done = resolve; });
    const opened = this.open$;
    const reduced = reducedMotion();
    gsap.set(this.flood, { opacity: 0, display: "block" });
    await gsap.to(this.flood, { opacity: 1, duration: reduced ? 0 : 0.25 });
    if (this.dead) return;
    opts.onCovered?.();
    this.siblings = [...this.ctx.ui.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== this.root && element !== this.flood)
      .map((element) => ({ element, inert: element.inert }));
    this.siblings.forEach(({ element }) => { element.inert = true; });
    this.root.hidden = false;
    // The AR stage disables zoom; readers of this document should be able to zoom.
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (viewport) {
      const original = viewport.content;
      const enabled = original.split(",").map((part) => part.trim()).filter((part) => !/^(maximum-scale|minimum-scale|user-scalable)\s*=/i.test(part)).join(", ");
      this.viewport = { element: viewport, original, enabled };
      viewport.content = enabled;
      // Next can refresh metadata after this dialog opens. Keep reader zoom
      // enabled for this visit, then restore the stage's viewport on exit.
      this.viewportObserver = new MutationObserver(() => {
        if (!this.root.hidden && viewport.content !== enabled) viewport.content = enabled;
      });
      this.viewportObserver.observe(viewport, { attributes: true, attributeFilter: ["content"] });
    }
    this.root.scrollTop = 0;
    this.close.disabled = false;
    void sound.sfx("paperSlide", 0.4);
    await gsap.fromTo(this.root, { opacity: 0, y: reduced ? 0 : 12 }, { opacity: 1, y: 0, duration: reduced ? 0 : 0.5, ease: "power2.out" });
    if (this.dead) return;
    gsap.set(this.flood, { opacity: 0, display: "none" });
    this.close.focus({ preventScroll: true });
    return opened;
  }

  private async leave() {
    if (!this.done || this.dead) return;
    const finish = this.done;
    this.done = undefined;
    this.close.disabled = true;
    void sound.sfx("paperTear", 0.4);
    await gsap.to(this.root, { opacity: 0, duration: reducedMotion() ? 0 : 0.25 });
    if (this.dead) return;
    this.root.hidden = true;
    this.restoreSiblings();
    this.open$ = undefined;
    finish();
    requestAnimationFrame(() => {
      if (!this.dead && this.previousFocus?.isConnected && this.previousFocus.getClientRects().length) this.previousFocus.focus({ preventScroll: true });
    });
  }

  private restoreSiblings() {
    this.viewportObserver?.disconnect();
    this.viewportObserver = undefined;
    if (this.viewport && this.viewport.element.content === this.viewport.enabled) {
      this.viewport.element.content = this.viewport.original;
    }
    this.viewport = undefined;
    this.siblings.forEach(({ element, inert }) => { element.inert = inert; });
    this.siblings = [];
  }

  destroy() {
    this.dead = true;
    this.observer?.disconnect();
    this.restoreSiblings();
    gsap.killTweensOf([this.root, this.flood]);
    this.done = undefined;
    this.open$ = undefined;
    this.root.remove();
    this.flood.remove();
  }
}
