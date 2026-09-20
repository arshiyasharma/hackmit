import { sound } from "../audio/sound";
import { manifest, type Piece } from "../data/manifest";
import { ease, gsap, wait } from "../motion";
import type { Ctx } from "./types";
import { h } from "./dom";

// Receipts reel (spec B4, C4 row "Receipts", E3 item 10): one DOM paper receipt
// per basket piece, over the face-down phone still. Every number is a masked
// stand-in of four digits. Nothing here is real card data, and nothing is sent.

type Edge = "left" | "top" | "bottom" | "right";

const EDGES: Edge[] = ["left", "top", "bottom", "right"];
const REST = [-6, 3, -2.5, 5];
const STAMP_REST = [-12, 8, -7, 11];
const DROP = [0, 14, -8, 10];

const price = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function receipt(piece: Piece, i: number) {
  const s = manifest.strings.receipt;
  // the mask always shows exactly four digits, whatever the manifest holds
  const digits = piece.masked.replace(/\D/g, "").slice(-4);
  const el = h("div", "receipt");
  el.setAttribute("role", "listitem");
  el.style.setProperty("--dy", `${DROP[i % DROP.length]}px`);
  const paper = h("div", "receipt-paper");
  const shop = h("span", "receipt-shop");
  shop.textContent = piece.shop;
  const name = h("span", "receipt-piece");
  name.textContent = piece.name;
  const cost = h("span", "receipt-price");
  cost.textContent = price(piece.price);
  const caption = h("span", "receipt-caption");
  caption.textContent = s.caption;
  const masked = h("span", "receipt-digits");
  masked.textContent = `.... ${digits}`;
  paper.append(shop, h("span", "receipt-rule"), name, cost, h("span", "receipt-rule"), caption, masked);
  const stamp = h("span", "receipt-stamp");
  stamp.textContent = s.stamp;
  el.append(paper, stamp);
  return { el, stamp };
}

/** How far the receipt has to start from its resting place to be fully off screen. */
function offscreen(el: HTMLElement, edge: Edge, W: number, H: number) {
  const r = el.getBoundingClientRect();
  const pad = 60;
  if (edge === "left") return { x: -(r.right + pad), y: 0 };
  if (edge === "right") return { x: W - r.left + pad, y: 0 };
  if (edge === "top") return { x: 0, y: -(r.bottom + pad) };
  return { x: 0, y: H - r.top + pad };
}

export async function runReceipts(ctx: Ctx): Promise<void> {
  const { ui, stage } = ctx;
  const row = h("div", "receipt-row");
  row.setAttribute("role", "list");
  const items = manifest.pieces.map((piece, i) => receipt(piece, i));
  for (const [i, item] of items.entries()) {
    gsap.set(item.el, { autoAlpha: 0, rotate: REST[i % REST.length] });
    gsap.set(item.stamp, { autoAlpha: 0, rotate: STAMP_REST[i % STAMP_REST.length] });
    row.appendChild(item.el);
  }
  ui.appendChild(row);

  const stampDown = async (stamp: HTMLElement) => {
    void sound.sfx("stamp");
    if (stage.reduced) await gsap.to(stamp, { autoAlpha: 0.88, duration: 0.25, ease: ease.out });
    else await gsap.fromTo(stamp, { scale: 1.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 0.88, duration: 0.25, ease: ease.out });
  };

  /** Slide one receipt in from its own edge, then stamp it. Resolves after the stamp. */
  const enter = async (i: number) => {
    const { el, stamp } = items[i];
    if (!el.isConnected) return;
    const rest = REST[i % REST.length];
    if (stage.reduced) {
      await gsap.to(el, { autoAlpha: 1, duration: 0.4, ease: ease.out });
    } else {
      const from = offscreen(el, EDGES[i % EDGES.length], stage.flat.W, stage.flat.H);
      void sound.sfx("paperSlide", 0.5);
      await gsap.fromTo(el, { ...from, rotate: rest * 3, autoAlpha: 1 }, { x: 0, y: 0, rotate: rest, duration: 0.8, ease: ease.pop });
    }
    if (el.isConnected) await stampDown(stamp);
  };

  // C4 pairs a receipt with each of the closing voice lines, and any receipts
  // beyond them follow 0.9s apart in silence. The basket length drives this, so
  // changing how many pieces the demo has needs no edit here.
  const VOICE = [8, 9, 10];
  const spoken = Math.min(items.length, VOICE.length);
  for (let i = 0; i < spoken; i++) {
    const line = ctx.say(VOICE[i]);
    // the last spoken line carries every receipt still waiting to arrive
    const rest = i === spoken - 1
      ? items.slice(i).map((_, k) => (k === 0 ? enter(i) : wait(0.9 * k).then(() => enter(i + k))))
      : [enter(i)];
    await Promise.all([line, ...rest]);
  }
  // Fewer pieces than closing lines: the leftovers are still spoken, so the
  // line the whole demo is about is never dropped with the fourth receipt.
  for (let i = spoken; i < VOICE.length; i++) await ctx.say(VOICE[i]);

  await wait(1.0);
}

/** Fade the receipts out and remove them. Called by the approve scene once the last card is answered. */
export async function clearReceipts(ctx: Ctx, seconds = 0.3): Promise<void> {
  const rows = Array.from(ctx.ui.querySelectorAll<HTMLElement>(".receipt-row"));
  if (!rows.length) return;
  await gsap.to(rows, { opacity: 0, duration: seconds, ease: ease.out });
  for (const row of rows) {
    gsap.killTweensOf(row.querySelectorAll(".receipt, .receipt-stamp"));
    gsap.killTweensOf(row);
    row.remove();
  }
}
