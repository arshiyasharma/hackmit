import { asset, manifest } from "../data/manifest";
import { sound } from "../audio/sound";
import { ease, gsap, wait } from "../motion";
import { h } from "./dom";
import { icon } from "./icons";
import { Tile } from "./Tile";
import type { Interaction } from "./types";

// Piece viewer for the rug (spec A11, M6; card deal and shuffle rows in C4):
// a stack of one facts card and four instant photos dealt from below. A tap
// sends the top card to the back, and the Add to basket tile takes its accent.

const random = (min: number, max: number) => min + Math.random() * (max - min);

export const runPieceViewer: Interaction = async (ctx) => {
  const { stage } = ctx;
  const post = stage.post.values;
  const s = manifest.strings.viewer;
  const cards = manifest.rugCards;
  const offs: (() => void)[] = [];

  const root = h("div", "viewer-root");
  const stack = h("button", "viewer-stack");
  stack.type = "button";
  stack.setAttribute("aria-label", `${s.hint}: show the next card`);
  root.appendChild(stack);
  ctx.ui.appendChild(root);

  // cards are spans so the whole stack can be one real button
  const els = cards.map((card) => {
    const el = h("span", `viewer-card viewer-${card.kind}`);
    el.style.setProperty("--viewer-accent", card.accent);
    if (card.kind === "facts") {
      el.innerHTML = `<span class="viewer-facts-text">${s.facts}</span><span class="viewer-hint">${icon("curvedArrow", 20)}<span>${s.hint}</span></span>`;
    } else {
      const frame = h("span", "viewer-img");
      const img = h("img");
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      // a missing photo keeps the card's layout and shows a tinted placeholder
      img.onerror = () => { frame.classList.add("viewer-missing"); img.remove(); };
      img.src = asset(card.src);
      frame.appendChild(img);
      el.appendChild(frame);
    }
    stack.appendChild(el);
    return el;
  });
  // the fan is cut right down on a phone: a 330px card turned 14deg measures
  // 422px across, which is wider than a 375px screen and loses its corners
  const tight = window.innerWidth < 768;
  const rest = els.map(() => (tight ? random(-5, 4) : random(-14, 10)));

  const add = new Tile(root, { icon: "bag", label: s.tile, aria: s.tile, rest: -2, from: "top", className: "viewer-add" });
  const close = new Tile(root, { icon: "close", aria: "Close and go back to the room", rest: 2, from: "bottom", className: "hud-close" });

  // order[0] is the top of the stack
  const order = els.map((_, i) => i);
  const restack = () => {
    order.forEach((card, depth) => {
      els[card].style.zIndex = String(order.length - depth);
      els[card].classList.toggle("viewer-top", depth === 0);
    });
    add.color = cards[order[0]].accent;
  };

  // the deal travels the height of the layer, not window.innerHeight: on iOS
  // those differ while the URL bar is moving and the cards start half in frame
  const below = () => root.clientHeight || window.innerHeight;
  gsap.set(els, { xPercent: -50, yPercent: -50, y: below, rotation: (i: number) => rest[i] });
  restack();

  await ctx.enterFlat(manifest.rooms.R2);

  let settle!: (earned: boolean) => void;
  const result = new Promise<boolean>((resolve) => { settle = resolve; });
  let busy = false;
  let over = false;

  // the plane renders through the same post pass, so the blur makes the stack read
  gsap.to(post, { focus: 1, veil: 1, duration: 0.5, ease: ease.out, overwrite: "auto" });

  // ---- deal (C4): bottom card first, so the facts card lands last and on top ----
  const dealt = [...order].reverse().map((card) => els[card]);
  if (stage.reduced) {
    gsap.set(els, { y: 0, opacity: 0 });
    gsap.to(els, { opacity: 1, duration: 0.4, ease: ease.out });
  } else {
    gsap.to(dealt, { y: 0, duration: 0.7, ease: ease.pop, stagger: 0.08 });
  }

  // ---- shuffle (C4) ----
  const shuffle = async () => {
    if (busy || over) return;
    busy = true;
    const top = order[0];
    const el = els[top];
    void sound.sfx("shutter");
    if (!stage.reduced) {
      await gsap.to(el, { x: el.offsetWidth * 1.15, rotation: rest[top] + 12, duration: 0.22, ease: ease.out });
      if (over) return;
    }
    order.push(order.shift()!);
    restack();
    busy = false; // the next card can go while this one slides home under the stack
    if (!stage.reduced) gsap.to(el, { x: 0, rotation: rest[top], duration: 0.28, ease: ease.out });
  };
  stack.addEventListener("click", () => void shuffle());

  const finish = async (earned: boolean) => {
    if (over) return;
    over = true;
    add.hide();
    close.hide();
    gsap.killTweensOf(els);
    gsap.to(post, { focus: 0, veil: 0, duration: 0.4, ease: ease.out, overwrite: "auto" });
    if (stage.reduced) gsap.to(els, { opacity: 0, duration: 0.3, ease: ease.out });
    else gsap.to(els, { y: below, duration: 0.3, ease: ease.exit, stagger: 0.02 });
    await wait(0.4);
    offs.forEach((off) => off());
    gsap.killTweensOf(els);
    ctx.cursor.hide();
    void ctx.toast.hide();
    add.destroy();
    close.destroy();
    root.remove();
    settle(earned);
  };
  add.onClick(() => void finish(true));
  close.onClick(() => void finish(false));

  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void finish(false); };
  window.addEventListener("keydown", onKey);
  offs.push(() => window.removeEventListener("keydown", onKey));

  add.show(0.5);
  close.show(0.6);
  stack.focus({ preventScroll: true });

  return result;
};
