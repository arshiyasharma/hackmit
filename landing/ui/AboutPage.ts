import { sound } from "../audio/sound";
import { asset } from "../data/manifest";
import { details, pitch, roadmap, sponsorTracks, visaStages } from "../data/pitch";
import { apiRoutes, dependencyGroups, stackGroups } from "../data/pitchStack";
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
    const safe = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    const video = (url: string, title: string, shape: string) => {
      const parsed = new URL(url);
      const id = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : parsed.pathname.includes("/shorts/") ? parsed.pathname.split("/shorts/")[1]?.split("/")[0] : parsed.searchParams.get("v");
      if (!["youtube.com", "www.youtube.com", "youtu.be"].includes(parsed.hostname) || !id || !/^[\w-]{11}$/.test(id)) return '<p>Video coming soon.</p>';
      const src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
      return `<iframe class="pitch-video pitch-video-${shape}" src="${src}" data-video-src="${src}" title="${safe(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    };
    this.root.innerHTML = `
      <header class="about-header">
        <a class="about-wordmark" href="#about-top" data-scroll="about-top" aria-label="PIXX-AR, back to top">PIXX-AR</a>
        <nav class="about-nav" aria-label="Pitch sections">
          <a href="#about-problem" data-scroll="about-problem">The idea</a><a href="#about-demo" data-scroll="about-demo">Demo</a><a href="#about-stack" data-scroll="about-stack">The build</a><a href="#about-details" data-scroll="about-details">Features</a><a href="#about-tracks" data-scroll="about-tracks">Tracks</a>
        </nav>
        <button type="button" class="about-back" aria-label="Back to the rooms">${icon("arrowLeft", 17)}<span>The rooms</span></button>
      </header>
      <div class="about-sheet">
        <section class="pitch-hero" id="about-top" aria-labelledby="about-title">
          <div class="pitch-hero-meta"><span>ROOM IV / THE STORY BEHIND PIXX-AR</span><span>BUILT AT HACKMIT 2026</span></div>
          <div class="pitch-hero-grid">
            <div class="pitch-hero-copy">
              <p class="pitch-eyebrow" data-hero-reveal>A little imagination. A place to begin.</p>
              <h1 id="about-title" data-hero-reveal><span>${safe(pitch.slogan[0])}</span><em>${safe(pitch.slogan[1])}</em></h1>
              <p class="pitch-hero-lede" data-hero-reveal>Your room is the starting point.<br/>Everything it could become is the possibility.</p>
              <a href="#about-problem" data-scroll="about-problem" class="pitch-button" data-hero-reveal>Step into our story ${icon("arrowRight", 19)}</a>
            </div>
            <div class="pitch-hero-collage" data-hero-reveal>
              <img class="pitch-hero-ribbon" src="${asset("about/hackmit/rabbit-ribbon.png")}" alt="" width="684" height="983" aria-hidden="true" />
              <figure class="pitch-hero-photo"><img src="${asset("about/photos/opening-ceremony.webp")}" alt="The PIXX-AR team together at HackMIT’s opening ceremony." width="1200" height="1600" fetchpriority="high"/><figcaption>Good company. Big ideas.</figcaption></figure>
              <figure class="pitch-hero-inset"><img src="${asset("about/photos/team-build.webp")}" alt="Working together around the hackathon build table." width="1600" height="900"/><figcaption>Somewhere between “what if” and “it works.”</figcaption></figure>
            </div>
          </div>
          <div class="pitch-hero-bottom"><span>Cambridge, Massachusetts / One unforgettable weekend</span><a href="#about-problem" data-scroll="about-problem">Scroll to explore <span aria-hidden="true">↓</span></a></div>
        </section>

        <section class="pitch-section pitch-problem" id="about-problem" aria-labelledby="pitch-problem-title">
          <p class="pitch-kicker"><span>01 / THE QUESTION</span><span>THE IDEA</span></p>
          <h2 id="pitch-problem-title">You know how you want<br class="pitch-desktop-break"/> your room to <em>feel.</em><br/>But what do you search for?</h2>
          <div class="pitch-problem-bottom"><p>A hundred open tabs. A sofa you love. A doorway it might not fit through. Shopping for a room means connecting inspiration, size, price, and different stores—all in your head.</p><p>We thought the room itself should do more of the talking.</p></div>
          <div class="pitch-solution" aria-label="Our solution in three steps">
            <article><span>01</span><h3>See it.</h3><p>Start with a photo and a feeling.</p></article>
            <article><span>02</span><h3>Find it.</h3><p>Discover real products that belong.</p></article>
            <article><span>03</span><h3>Make it yours.</h3><p>Place, compare, and review together.</p></article>
          </div>
        </section>

        <section class="pitch-section pitch-validation" id="about-validation" aria-labelledby="pitch-validation-title">
          <p class="pitch-kicker"><span>02 / OUTSIDE OUR OWN BUBBLE</span><span>VALIDATION</span></p>
          <div class="pitch-validation-grid">
            <div class="pitch-interview"><div class="pitch-phone-film">${video(pitch.validationVideoUrl, "Conversations that inspired PIXX-AR", "short")}</div><a class="pitch-small-link" href="${safe(pitch.validationVideoUrl)}" target="_blank" rel="noopener noreferrer">Watch the interviews on YouTube ↗</a></div>
            <div class="pitch-validation-copy"><h2 id="pitch-validation-title">First, we asked.<br/><em>Then, we built.</em></h2><p>We took the question to real people: what makes shopping for your space harder than it should be?</p><p>Those conversations helped turn a vague idea into a product worth building.</p><div class="pitch-metric"><strong>${safe(pitch.signups)}</strong><span>signups on our MVP.<br/><b>A reason to keep going.</b></span></div><p class="pitch-caption">Early interest, real conversations, and a whole lot to learn.</p></div>
          </div>
        </section>

        <section class="pitch-section pitch-demo" id="about-demo" aria-labelledby="pitch-demo-title">
          <p class="pitch-kicker"><span>03 / FROM A ROOM TO A POSSIBILITY</span><span>THE DEMO</span></p>
          <div class="pitch-section-heading"><h2 id="pitch-demo-title">Watch a room<br/><em>come together.</em></h2><p>A photo. An everyday request. Real products, in context.<br/>Here is the journey we built.</p></div>
          ${pitch.demoVideoUrl ? `<div class="pitch-demo-player">${video(pitch.demoVideoUrl, "PIXX-AR product walkthrough", "wide")}</div>` : `<div class="pitch-demo-placeholder"><img src="${asset("about/photos/hallway-build.webp")}" alt="The team building PIXX-AR together in the hallway." width="1200" height="1600" loading="lazy"/><div class="pitch-demo-shade"></div><div class="pitch-demo-message"><span class="pitch-film-label">THE PRODUCT WALKTHROUGH</span><span class="pitch-play" aria-hidden="true">${icon("play", 32)}</span><h3>A little space.<br/>A lot of possibility.</h3><p>Demo film coming soon.</p></div><div class="pitch-demo-timeline"><span>01 / Photograph</span><span>02 / Discover</span><span>03 / Place</span><span>04 / Review</span></div></div>`}
          <div class="pitch-demo-footer"><span>Want to explore it yourself?</span><a class="pitch-text-link" href="/landing?product">Enter the room ${icon("arrowRight", 19)}</a></div>
        </section>

        <section class="pitch-section pitch-stack" id="about-stack" aria-labelledby="pitch-stack-title">
          <p class="pitch-kicker"><span>04 / EVERY PIECE HAS A PURPOSE</span><span>THE BUILD</span></p>
          <div class="pitch-section-heading"><h2 id="pitch-stack-title">Under<br/><em>the hood.</em></h2><p>Room intelligence, product discovery, spatial previews, and controlled checkout.<br/>One connected system.</p></div>
          <div class="pitch-stack-toolbar"><label for="pitch-stack-search">Explore the stack</label><input id="pitch-stack-search" type="search" placeholder="Find a tool, API, or capability…" autocomplete="off"/><span id="pitch-stack-count" role="status" aria-live="polite"></span></div>
          <div class="pitch-table-wrap" tabindex="0" role="region" aria-label="Technology stack, scroll horizontally for all columns"><table class="pitch-table"><caption class="pitch-sr-only">PIXX-AR technology stack and integration status</caption><thead><tr><th scope="col">Layer / technology</th><th scope="col">What it does here</th><th scope="col">In this prototype</th></tr></thead><tbody>${stackGroups.map(group => group.items.map((row, i) => `<tr data-stack-row data-search="${safe(`${group.title} ${row.name} ${row.detail} ${row.status}`.toLowerCase())}"><th scope="row">${i === 0 ? `<small>${safe(group.title)}</small>` : ""}<strong>${safe(row.name)}</strong></th><td>${safe(row.detail)}</td><td><span class="pitch-status">${safe(row.status)}</span></td></tr>`).join("")).join("")}</tbody></table></div>
          <p class="pitch-no-results" hidden>No matching tools. Try “Visa”, “image”, or “search”.</p>
          <details class="pitch-inventory"><summary>The API map <span>${apiRoutes.length} routes ${icon("arrowRight", 18)}</span></summary><div class="pitch-table-wrap" tabindex="0" role="region" aria-label="API routes"><table class="pitch-table pitch-api-table"><caption class="pitch-sr-only">Server API inventory</caption><thead><tr><th scope="col">Method / route</th><th scope="col">Responsibility</th><th scope="col">Status</th></tr></thead><tbody>${apiRoutes.map(row => `<tr><th scope="row"><small>${safe(row.method)}</small><code>${safe(row.path)}</code></th><td>${safe(row.detail)}</td><td>${safe(row.status)}</td></tr>`).join("")}</tbody></table></div></details>
          <details class="pitch-inventory"><summary>The complete dependency inventory <span>Libraries & tooling ${icon("arrowRight", 18)}</span></summary><div class="pitch-dependencies">${dependencyGroups.map(group => `<div><h3>${safe(group.title)}</h3><p>${safe(group.body)}</p></div>`).join("")}</div></details>
          <a class="pitch-small-link" href="${safe(pitch.repository)}" target="_blank" rel="noopener noreferrer">Explore the code on GitHub ↗</a>
        </section>

        <section class="pitch-section pitch-depth" id="about-details" aria-labelledby="pitch-depth-title">
          <p class="pitch-kicker"><span>05 / BUILT IN</span><span>ADDITIONAL FEATURES</span></p>
          <h2 id="pitch-depth-title">Key <em>features.</em></h2>
          <div class="pitch-depth-grid">${details.map(item => `<article><h3>${safe(item.title)}</h3><p>${safe(item.body)}</p></article>`).join("")}</div>
        </section>

        <section class="pitch-section pitch-future" id="about-next" aria-labelledby="pitch-next-title"><p class="pitch-kicker"><span>06 / JUST THE BEGINNING</span><span>WHAT’S NEXT</span></p><div class="pitch-section-heading"><h2 id="pitch-next-title">AR &amp;<br/><em>3D spaces.</em></h2><p>Bring the room off the screen.<br/>Make the whole space part of the experience.</p></div><div class="pitch-roadmap">${roadmap.map((item, i) => `<article><span>0${i + 1}</span><h3>${safe(item.title)}</h3><p>${safe(item.body)}</p></article>`).join("")}</div></section>

        <section class="pitch-section pitch-tracks" id="about-tracks" aria-labelledby="pitch-tracks-title"><p class="pitch-kicker"><span>07 / SPONSOR TRACKS</span><span>SPONSOR TRACKS</span></p><div class="pitch-section-heading"><h2 id="pitch-tracks-title">One project.<br/><em>A bigger brief.</em></h2><p>How PIXX-AR connects with the challenges<br/>that brought us here.</p></div>
          <article class="pitch-visa"><div class="pitch-visa-heading"><img src="${asset("about/visa-logo.png")}" alt="Visa" width="960" height="312" loading="lazy"/><span class="pitch-status">FEATURED TRACK</span></div><h3>Reimagine Shopping.</h3><p class="pitch-visa-intro">Visa asks how AI can transform the shopping journey. We designed against all seven stages—and built the loop from discovery to a verified sandbox payment.</p><div class="pitch-visa-proof"><span>VERIFIED IN OUR MERCHANT PORTAL</span><strong>$119.99 <small>authorized in sandbox</small></strong><p>Signed request. Test card. Capture disabled.</p></div><div class="pitch-visa-stages">${visaStages.map((stage,i) => `<details ${i===4 ? "open" : ""}><summary><span class="pitch-stage-number">0${i+1}</span><span>${safe(stage.title)}</span><span class="pitch-stage-status">${safe(stage.status)}</span><span class="pitch-expand" aria-hidden="true">+</span></summary><div class="pitch-stage-body"><div><span>THE OPPORTUNITY</span><p>${safe(stage.ask)}</p></div><div><span>OUR RESPONSE</span><p>${safe(stage.answer)}</p></div></div></details>`).join("")}</div><details class="pitch-script"><summary>The 45-second pitch ${icon("arrowRight",18)}</summary><blockquote>“PIXX-AR starts where shopping should: in your room. A photo and a vague feeling become a search for real products. Your room’s colors and style shape discovery; dimension-aware previews help you decide. One basket brings the choices together across retailers. We then demonstrate the payment step with signed Visa Acceptance sandbox authorizations, verified in our own merchant portal. The prototype simulates retailer checkout; VIC tokenization and passkey consent are our next step. Across the journey, the goal is the same: less guesswork between the room you have and the room you imagine.”</blockquote></details></article>
          <div class="pitch-sponsor-grid">${sponsorTracks.map(track => `<article><span class="pitch-eyebrow">${safe(track.tag)}</span><h3 class="pitch-sponsor-identity"><span class="pitch-sr-only">${safe(track.sponsor)}</span>${track.logos.map(logo => `<img class="pitch-logo-${logo.file.split(".")[0]}" src="${asset(`about/sponsors/${logo.file}`)}" alt="" aria-hidden="true" width="${logo.width}" height="${logo.height}" loading="lazy"/>`).join("")}</h3><h4>${safe(track.title)}</h4><p>${safe(track.body)}</p></article>`).join("")}</div><p class="pitch-track-source">Track briefs: <a href="https://dayof.hackmit.org/resources" target="_blank" rel="noopener noreferrer">HackMIT sponsor challenges ↗</a></p>
        </section>
        <section class="pitch-thanks" aria-labelledby="pitch-thanks-title"><img src="${asset("about/hackmit/about-cloud.png")}" alt="" width="1548" height="1037" loading="lazy" aria-hidden="true"/><div><p class="pitch-eyebrow">TO EVERYONE WHO MADE THIS WEEKEND POSSIBLE</p><h2 id="pitch-thanks-title">Thank you,<br/><em>HackMIT.</em></h2><p>To the judges, organizers, mentors, volunteers, and every person who stopped to share an idea: this room is better because you were in it.</p><a href="/landing?product" class="pitch-button">Explore PIXX-AR ${icon("arrowRight",19)}</a></div></section>
        <footer class="about-footer"><span class="about-wordmark">PIXX-AR</span><p>Made with curiosity, in Cambridge.<br/><small>HackMIT illustrations supplied by our team.</small></p><a href="#about-top" data-scroll="about-top">Back to top ↑</a></footer>
      </div>
`;
    const search = this.root.querySelector<HTMLInputElement>("#pitch-stack-search")!;
    const rows = [...this.root.querySelectorAll<HTMLElement>("[data-stack-row]")];
    search.addEventListener("input", () => {
      const query = search.value.toLowerCase().trim();
      rows.forEach(row => { row.hidden = !row.dataset.search?.includes(query); });
      const matches = rows.filter(row => !row.hidden).length;
      this.root.querySelector("#pitch-stack-count")!.textContent = query ? `${matches} matching ${matches === 1 ? "entry" : "entries"}` : "";
      this.root.querySelector<HTMLElement>(".pitch-no-results")!.hidden = matches > 0;
    });
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
      const targets = [...this.root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, summary, iframe, [tabindex='0']")].filter((el) => el.getClientRects().length > 0);
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
    this.root.querySelectorAll("#about-problem, #about-demo, #about-stack, #about-details, #about-tracks").forEach((section) => this.observer!.observe(section));
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
    this.root.querySelectorAll<HTMLIFrameElement>("[data-video-src]").forEach(frame => { if (frame.src === "about:blank") frame.src = frame.dataset.videoSrc!; });
    this.root.scrollTop = 0;
    this.close.disabled = true;
    void sound.sfx("paperSlide", 0.4);
    await gsap.fromTo(this.root, { opacity: 0, y: reduced ? 0 : 12 }, { opacity: 1, y: 0, duration: reduced ? 0 : 0.5, ease: "power2.out" });
    if (this.dead) return;
    gsap.set(this.flood, { opacity: 0, display: "none" });
    if (!reduced) gsap.fromTo(this.root.querySelectorAll("[data-hero-reveal]"), { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: .85, stagger: .1, ease: "power2.out", clearProps: "opacity,transform" });
    this.close.disabled = false;
    this.close.focus({ preventScroll: true });
    return opened;
  }

  private async leave() {
    if (!this.done || this.dead || this.close.disabled) return;
    const finish = this.done;
    this.done = undefined;
    this.close.disabled = true;
    void sound.sfx("paperTear", 0.4);
    await gsap.to(this.root, { opacity: 0, duration: reducedMotion() ? 0 : 0.25 });
    if (this.dead) return;
    this.root.hidden = true;
    this.root.querySelectorAll<HTMLIFrameElement>("[data-video-src]").forEach(frame => { frame.src = "about:blank"; });
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
    gsap.killTweensOf([this.root, this.flood, ...this.root.querySelectorAll("[data-hero-reveal]")]);
    this.done = undefined;
    this.open$ = undefined;
    this.root.remove();
    this.flood.remove();
  }
}
