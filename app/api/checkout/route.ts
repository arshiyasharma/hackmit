import { after } from "next/server";
import type { NextRequest } from "next/server";

import { runCheckout } from "@/lib/checkout/agent";
import {
  formatMoneyMinor,
  subtotalMinor,
} from "@/lib/checkout/basket";
import { createRun, findRunByBasketId, getRun, isTerminal, updateLine } from "@/lib/checkout/runs";
import { checkoutOwner, ownerCookie, readObject, rejectCrossOrigin } from "@/lib/checkout/request";
import { hostBelongsTo } from "@/lib/checkout/retailers";
import type { Basket, BasketLine, Retailer } from "@/lib/checkout/types";

/**
 * POST /api/checkout — hand the basket to the agent.
 *
 * In:  { basket: Basket }
 * Out: { runId, lines: [{ lineId, status: { state: "pending" } }] }
 *
 * IT ANSWERS BEFORE ANY WORK HAPPENS. The run is created, every line is
 * pending, and the response goes back inside a few milliseconds. The walk
 * itself is Prompt 3's `runCheckout(runId)`, kicked off after this returns —
 * awaiting it here would leave the button spinning for fifteen seconds and
 * throw away the whole point of showing the walk.
 *
 * VALIDATION IS THE JOB. Invalid baskets are refused with a readable reason:
 *   - an empty basket
 *   - a line with no product URL, because the agent has nowhere to go and the
 *     judge has nothing to tap
 *   - a missing or invalid budget
 *   - a subtotal over the budget, including a zero budget
 * The budget is a hard cap. A subtotal equal to it is allowed.
 *
 * No money moves here and no retailer is contacted here. This route creates a
 * record and returns its id.
 */

export const runtime = "nodejs";
/**
 * The response leaves in milliseconds, but `after()` keeps the function alive
 * for the walk, and the walk is about ten seconds per four lines. This is the
 * ceiling for both together, not for the response.
 */
export const maxDuration = 60;

const RETAILERS: ReadonlySet<string> = new Set<Retailer>([
  "amazon",
  "wayfair",
  "ikea",
  "target",
  "westelm",
  "cb2",
  "etsy",
]);

/** A whole, nonnegative number of cents — or nothing. Never a float. */
function minor(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000
    ? value
    : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bad(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

type LineProblem = { index: number; reason: string };

/** One line, or the sentence explaining why it is not one. */
function toLine(raw: unknown, index: number): BasketLine | LineProblem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { index, reason: "one of the items in your basket is empty" };
  }
  const r = raw as Record<string, unknown>;

  const title = str(r.title) || `item ${index + 1}`;
  const productUrl = str(r.productUrl);
  if (!productUrl) {
    return {
      index,
      reason: `${title} has no link to the shop that sells it`,
    };
  }

  const lineId = str(r.lineId);
  const placementId = str(r.placementId);
  if (!lineId || !placementId) {
    return { index, reason: `${title} is missing its id` };
  }

  const retailer = str(r.retailer);
  if (!RETAILERS.has(retailer)) {
    return { index, reason: `we do not know the shop behind ${title}` };
  }

  const priceMinor = minor(r.priceMinor);
  if (priceMinor === undefined || priceMinor <= 0) {
    return { index, reason: `${title} has no price on it` };
  }

  if (r.currency !== "USD") {
    return { index, reason: `${title} is not priced in dollars` };
  }

  let url: URL;
  try { url = new URL(productUrl); } catch {
    return { index, reason: `${title} has an invalid shop link` };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !hostBelongsTo(retailer as Retailer, url.hostname)) {
    return { index, reason: `${title} has a link that does not belong to its shop` };
  }
  const quantity = r.quantity === undefined ? 1 : r.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
    return { index, reason: `${title} needs a quantity between 1 and 99` };
  }
  if (priceMinor * quantity > 100_000_000) {
    return { index, reason: `${title} exceeds the test checkout amount limit` };
  }
  if (lineId.length > 128 || placementId.length > 128 || !str(r.listingId) || str(r.listingId).length > 256 || title.length > 500 || productUrl.length > 4096) {
    return { index, reason: `${title.slice(0, 80)} has invalid item details` };
  }

  const d = r.dimensionsMm;
  const dimensionsMm =
    d && typeof d === "object" &&
    [(d as Record<string, unknown>).w, (d as Record<string, unknown>).h, (d as Record<string, unknown>).d].every(
      (n) => typeof n === "number" && Number.isInteger(n) && n > 0
    )
      ? {
          w: (d as Record<string, number>).w,
          h: (d as Record<string, number>).h,
          d: (d as Record<string, number>).d,
        }
      : null;

  return {
    lineId,
    placementId,
    listingId: str(r.listingId),
    retailer: retailer as Retailer,
    title,
    productUrl,
    imageUrl: str(r.imageUrl),
    priceMinor,
    currency: "USD",
    dimensionsMm,
    quantity,
  };
}

function isProblem(value: BasketLine | LineProblem): value is LineProblem {
  return "reason" in value;
}

/**
 * Start the walk WITHOUT blocking this response.
 *
 * `after()` is the Next 16 way to do post-response work: the body is already
 * on the wire, and the platform keeps the function alive until the callback
 * finishes, up to `maxDuration`. That matters on Vercel, where a plain
 * un-awaited promise can be killed the moment the response completes.
 *
 * `after()` needs a request scope, so it throws when the handler is called
 * directly from a unit test. That fallback is the `catch` — detached there,
 * scheduled here.
 */
function startWalk(runId: string): void {
  const walk = () =>
    runCheckout(runId).catch((error: unknown) => {
      console.error("[api/checkout] walk failed", runId);
      const run = getRun(runId);
      for (const line of run?.lines ?? []) {
        if (!isTerminal(line.status)) updateLine(runId, line.lineId, {
          state: "failed", reason: "Checkout could not finish. No retailer order was placed.",
        });
      }
      void error;
    });

  try {
    after(walk);
  } catch {
    void walk();
  }
}

export async function POST(request: NextRequest) {
  const forbidden = rejectCrossOrigin(request);
  if (forbidden) return forbidden;
  const body = await readObject(request);
  if (!body) return bad("We could not read that basket. Try pressing checkout again.");

  const raw = body.basket;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return bad("There is no basket to check out.");
  }
  const rawBasket = raw as Record<string, unknown>;

  const rawLines = Array.isArray(rawBasket.lines) ? rawBasket.lines : [];
  if (rawLines.length === 0) {
    return bad(
      "Your basket is empty. Link a listing to something standing in your room first."
    );
  }

  if (rawLines.length > 12) return bad("Please check out at most 12 items at a time.");
  const parsed = rawLines.map(toLine);
  const problem = parsed.find(isProblem);
  if (problem) {
    return bad(
      `We cannot buy this yet — ${problem.reason}. Open it in the room and pick a listing again.`
    );
  }

  const lines = parsed as BasketLine[];
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length ||
      new Set(lines.map((line) => line.placementId)).size !== lines.length) {
    return bad("An item appears twice in this checkout. Refresh the review and try again.");
  }
  const budgetMinor = minor(rawBasket.budgetMinor);
  if (budgetMinor === undefined) {
    return bad("Set a valid budget in whole cents before checking out.");
  }
  if (str(rawBasket.basketId).length > 128) return bad("That basket id is not valid.");
  const basket: Basket = {
    basketId: str(rawBasket.basketId) || crypto.randomUUID(),
    lines,
    budgetMinor,
  };

  const subtotal = subtotalMinor(basket);
  if (!Number.isSafeInteger(subtotal) || subtotal > 100_000_000) {
    return bad("That basket exceeds the test checkout amount limit.");
  }
  if (subtotal > basket.budgetMinor) {
    const over = subtotal - basket.budgetMinor;
    return bad(
      `This basket comes to ${formatMoneyMinor(subtotal)}, which is ` +
        `${formatMoneyMinor(over)} more than the ` +
        `${formatMoneyMinor(basket.budgetMinor)} you set. Remove an item or ` +
        `choose a lower-priced listing to stay within your budget.`
    );
  }

  const ownerId = checkoutOwner(request) ?? crypto.randomUUID();
  const previous = findRunByBasketId(basket.basketId, ownerId);
  if (previous && JSON.stringify(previous.basket) !== JSON.stringify(basket)) {
    return Response.json({ error: "This basket was already submitted with different items. Review it again." },
      { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const run = previous ?? createRun(basket, ownerId);

  // never awaited: the button must not wait out a ten-second walk
  if (!previous) startWalk(run.runId);

  return Response.json(
    { runId: run.runId, lines: run.lines },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": ownerCookie(request, ownerId) } }
  );
}
