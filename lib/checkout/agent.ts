/**
 * The agent that works the basket, shop by shop.
 *
 * THIS IS THE PART THE JUDGE WATCHES, so it is paced for a human: one line
 * moves at a time, and each move is written to the run store the instant it
 * happens rather than batched at the end. The stream endpoint reads those
 * writes and the overlay redraws. If every row lit up at once the walk would
 * be over before anyone could read it.
 *
 * IT BUYS NOTHING AND IT CONTACTS NOBODY. There is no `fetch` in this file and
 * there is not going to be one — not a HEAD, not a prefetch, not a favicon.
 * Test mode is the default, it is what the demo runs, and it completes with
 * the wifi off. The retailer walk is a SIMULATION PER STORE, because no
 * retailer exposes an API we could buy through, and saying so plainly is a
 * better answer than any bluff.
 *
 * The live branch exists so the code is honest about its own boundary. It
 * throws. Point at it when someone asks whether you are really buying things.
 */

import { getRun, updateLine } from "./runs";
import type { BasketLine, Retailer } from "./types";

/**
 * How long a line rests in each state. Slow enough to read from two metres,
 * short enough that a four-line basket is done inside a sentence of patter.
 * One constant, used three times — never a number written at the call site.
 */
export const STEP_MS = 800;

/** How the run is allowed to behave. "live" needs BOTH env vars, and throws. */
export type CheckoutMode = "test" | "live";

/**
 * Test unless someone set `CHECKOUT_MODE=live` AND `ENABLE_REAL_ORDERS=true`.
 *
 * `CHECKOUT_MODE=live` on its own is deliberately not enough: half a flag is
 * how an accident happens, and the demo's safety story is that the checkout
 * button cannot reach real ordering no matter what one variable says.
 *
 * Read here, per call, never at module top level — an env var captured at
 * import time survives a change nobody intended.
 */
export function resolveMode(): CheckoutMode {
  return process.env.CHECKOUT_MODE === "live" &&
    process.env.ENABLE_REAL_ORDERS === "true"
    ? "live"
    : "test";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `TEST-IKEA-3F9A21C4`. Unmistakably not a real order number. */
function testOrderRef(retailer: Retailer): string {
  const short = crypto.randomUUID().split("-")[0].toUpperCase();
  return `TEST-${retailer.toUpperCase()}-${short}`;
}

/**
 * Lines grouped by shop, in the order the shops first appear in the basket.
 * The grouping IS the argument on screen — three shops, one button — so the
 * walk has to visit them one at a time rather than interleaving.
 */
export function groupByRetailer(
  lines: readonly BasketLine[]
): Array<{ retailer: Retailer; lines: BasketLine[] }> {
  const groups = new Map<Retailer, BasketLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.retailer);
    if (existing) existing.push(line);
    else groups.set(line.retailer, [line]);
  }
  return [...groups.entries()].map(([retailer, grouped]) => ({
    retailer,
    lines: grouped,
  }));
}

export interface RunCheckoutOptions {
  /** overrides STEP_MS. Tests pass a small number; nothing else should. */
  stepMs?: number;
}

/**
 * Walk the run to completion.
 *
 * Shops in order, lines within a shop in order, each line through
 * `walking` -> `authorizing` -> `placed`. Every transition is an `updateLine`
 * call, so the store is always the truth and the stream never has to guess.
 *
 * Throws before touching a single line when both live flags are set. Nothing
 * moves, no line is marked failed, and the caller sees the error — pretending
 * to walk in a mode we have not built would be the dishonest option.
 */
export async function runCheckout(
  runId: string,
  options: RunCheckoutOptions = {}
): Promise<void> {
  const mode = resolveMode();
  if (mode === "live") {
    // The boundary, said out loud. We do not place real orders and this branch
    // is the proof that we know where that line is.
    throw new Error("Live ordering is not implemented");
  }

  const run = getRun(runId);
  if (!run) return;

  const stepMs = options.stepMs ?? STEP_MS;

  for (const group of groupByRetailer(run.basket.lines)) {
    for (const line of group.lines) {
      // the run can go away under us — a dev-server reload empties the store.
      // Stop rather than writing states nobody will ever read.
      if (!getRun(runId)) return;

      await sleep(stepMs);
      updateLine(runId, line.lineId, { state: "walking" });

      await sleep(stepMs);
      updateLine(runId, line.lineId, { state: "authorizing" });

      await sleep(stepMs);
      updateLine(runId, line.lineId, {
        state: "placed",
        orderRef: testOrderRef(group.retailer),
        mode: "test",
      });
    }
  }
}
