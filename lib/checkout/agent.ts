/**
 * The agent that works the basket, shop by shop.
 *
 * THIS IS THE PART THE JUDGE WATCHES, so it is paced for a human: one line
 * moves at a time, and each move is written to the run store the instant it
 * happens rather than batched at the end. The stream endpoint reads those
 * writes and the overlay redraws. If every row lit up at once the walk would
 * be over before anyone could read it.
 *
 * IT BUYS NOTHING AND IT CONTACTS NO RETAILER. There is no `fetch` in this
 * file and there is not going to be one — not a HEAD, not a prefetch, not a
 * favicon. Test mode is the default, it is what the demo runs, and it
 * completes with the wifi off. The retailer walk is a SIMULATION PER STORE,
 * because no retailer exposes an API we could buy through, and saying so
 * plainly is a better answer than any bluff.
 *
 * ONE THING DOES LEAVE, and only to ourselves. Before a line is authorised the
 * agent signs a Trusted Agent Protocol request for that line's product URL and
 * presents it to our stand-in merchant. By default that is an in-process call
 * to the same verifier the HTTP endpoint runs; set `TAP_VERIFY_BASE_URL` and
 * it becomes a POST to our own `/api/retailer/{retailer}/verify`. Either way
 * the transport lives in `lib/tap/merchant.ts`, never here, and neither one
 * touches a retailer.
 *
 * The live branch exists so the code is honest about its own boundary. It
 * throws. Point at it when someone asks whether you are really buying things.
 */

import {
  MerchantUnreachableError,
  presentToMerchant,
  tapIsConfigured,
} from "@/lib/tap/merchant";
import { failureSentence, type TapFailure } from "@/lib/tap/verify";

import {
  authorize,
  MissingAcceptanceCredentialsError,
} from "@/lib/visaAcceptance/payments";

import { lineTotalMinor } from "./basket";
import { getRun, isTerminal, updateLine } from "./runs";
import type {
  BasketLine,
  PaymentLineResult,
  Retailer,
  TapLineVerdict,
} from "./types";

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

/**
 * Who actually authorizes: nobody, or Visa's sandbox.
 *
 * "simulated" is the default and is what the demo runs — the walk completes
 * with the wifi off, which is a rehearsal item and not a nice-to-have. Set
 * `PAYMENT_PROVIDER=acceptance` and each line is authorized for real against
 * `apitest.visaacceptance.com` before it is marked placed. Nothing else in the
 * walk changes, which is the point of the flag.
 *
 * Neither value places a retailer order. Authorizing is not buying, and the
 * order reference stays `TEST-` prefixed either way, because the order really
 * is simulated and the authorization really is not.
 */
export type PaymentProvider = "simulated" | "acceptance";

export function resolvePaymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "acceptance" ? "acceptance" : "simulated";
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

/**
 * Show the shop who we are, for this exact page, for this exact operation.
 *
 * Returns undefined when TAP is not configured at all — no keys in the
 * environment means the identity layer is switched off, and a line should walk
 * without it rather than fail for a reason the operator never opted into. Run
 * `npm run keys:tap` and the beat appears.
 *
 * Everything else is a verdict, including a refusal. A failed verification
 * fails the line; it is never swallowed, and it is never downgraded to a
 * warning. That is the point of doing it.
 */
async function presentIdentity(
  retailer: Retailer,
  productUrl: string
): Promise<TapLineVerdict | undefined> {
  if (!tapIsConfigured()) return undefined;

  try {
    // "payment": this is the checkout step, not a browse. Passing the wrong
    // tag here is exactly what the merchant is supposed to catch.
    const result = await presentToMerchant({ retailer, targetUrl: productUrl, tag: "payment" });

    if (!result.verdict.ok) {
      return { ok: false, reason: result.verdict.reason, via: result.via };
    }

    if (!result.accepted) {
      // a valid signature for the wrong operation. Cryptographically fine,
      // and still not permission to spend money.
      return {
        ok: false,
        reason: "the agent was only cleared to browse, not to buy",
        agentId: result.verdict.agentId,
        agentName: result.verdict.agentName,
        tag: result.verdict.tag,
        via: result.via,
      };
    }

    return {
      ok: true,
      agentId: result.verdict.agentId,
      agentName: result.verdict.agentName,
      tag: result.verdict.tag,
      via: result.via,
    };
  } catch (error) {
    if (error instanceof MerchantUnreachableError) {
      return { ok: false, reason: "the shop's verifier did not answer", via: "http" };
    }
    // a missing or unusable signing key. Loud, named, and fatal to the line.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "the agent could not sign",
    };
  }
}

/** The sentence a person reads when identity is why a line did not go through. */
function refusalSentence(retailer: Retailer, tap: TapLineVerdict): string {
  const reason = tap.reason ?? "the shop refused the agent's signature";
  const known: ReadonlySet<string> = new Set<TapFailure>([
    "unknown-key",
    "malformed",
    "expired",
    "bad-signature",
    "authority-mismatch",
    "path-mismatch",
  ]);
  const said = known.has(reason) ? failureSentence(reason as TapFailure) : reason;
  return `${retailer} would not take this order — ${said}.`;
}

/**
 * Ask Visa to authorize this line, when a provider is switched on.
 *
 * Returns undefined when the provider is "simulated" — nothing was asked, so
 * nothing is reported, and no `payment` field appears on the line. Everything
 * else is a result, including a decline, and a decline fails the line: a run
 * that shows `placed` for an amount Visa refused would be a lie told to a
 * judge with a laptop.
 */
async function authorizeLine(
  line: BasketLine
): Promise<
  { payment: PaymentLineResult } | { failure: string } | undefined
> {
  if (resolvePaymentProvider() !== "acceptance") return undefined;

  try {
    const result = await authorize({
      amountMinor: lineTotalMinor(line),
      currency: line.currency,
      clientReferenceCode: `VRA-${line.lineId.slice(-12)}`,
    });

    if (result.status !== "AUTHORIZED") {
      return {
        failure:
          `Visa did not authorize this one — it came back ${result.status}.`,
      };
    }

    return {
      payment: {
        provider: "acceptance",
        status: result.status,
        reconciliationId: result.reconciliationId,
        authorizedAmount: result.authorizedAmount,
        approvalCode: result.approvalCode,
        correlationId: result.correlationId,
        merchant: "shared-test",
        captured: false,
      },
    };
  } catch (error) {
    if (error instanceof MissingAcceptanceCredentialsError) {
      return { failure: "Visa's sandbox is switched on but not configured." };
    }
    return { failure: "We could not reach Visa's sandbox for this one." };
  }
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
  if (!run || run.startedAt !== undefined || run.finishedAt !== null) return;
  run.startedAt = Date.now();

  const stepMs = options.stepMs ?? STEP_MS;
  const deadline = Date.now() + 40_000;

  for (const group of groupByRetailer(run.basket.lines)) {
    for (const line of group.lines) {
      // the run can go away under us — a dev-server reload empties the store.
      // Stop rather than writing states nobody will ever read.
      if (!getRun(runId)) return;
      if (isTerminal(run.lines.find((entry) => entry.lineId === line.lineId)!.status)) continue;

      if (Date.now() >= deadline) {
        updateLine(runId, line.lineId, { state: "failed", reason: "Checkout timed out before reaching this item. No order was placed." });
        continue;
      }
      await sleep(stepMs);
      updateLine(runId, line.lineId, { state: "walking" });

      await sleep(stepMs);

      // the identity beat. It happens on the way into `authorizing`, so the
      // overlay can show "signature verified · <agentId>" at the moment the
      // line starts asking to spend money.
      const tap = await presentIdentity(group.retailer, line.productUrl);
      if (tap && !tap.ok) {
        updateLine(runId, line.lineId, {
          state: "failed",
          reason: refusalSentence(group.retailer, tap),
          tap,
        });
        continue;
      }

      updateLine(runId, line.lineId, { state: "authorizing", tap });

      // the payment beat. Absent unless PAYMENT_PROVIDER=acceptance, in which
      // case this is a real signed authorization against a Visa sandbox — a
      // hold on a shared test merchant, never captured.
      const authorized = await authorizeLine(line);
      if (authorized && "failure" in authorized) {
        updateLine(runId, line.lineId, {
          state: "failed",
          reason: authorized.failure,
          tap,
        });
        continue;
      }

      await sleep(stepMs);
      updateLine(runId, line.lineId, {
        state: "placed",
        orderRef: testOrderRef(group.retailer),
        mode: "test",
        tap,
        payment: authorized?.payment,
      });
    }
  }
}
