import Stripe from "stripe";
import type { PurchaseRecord } from "./types";

/**
 * Visa Intelligent Commerce adapter.
 *
 * WHAT IS REAL: the mandate authorization below is a single, real, tokenized card
 * transaction. One payment covers the whole basket, exactly as the pitch describes.
 *
 * WHAT IS SIMULATED: `placeOrder` — the per-retailer order placement. No public API
 * (Visa's or anyone's) can place a real order on Etsy/IKEA/Wayfair; real VIC is a
 * merchant-side partner integration. Each agent draws against the real mandate and
 * records a simulated retailer order.
 *
 * TO GO LIVE: replace the body of `placeOrder` with the partner endpoint. The rest
 * of the swarm, constraints, and UI need no changes.
 */

export type MandateAuthorization = {
  mandateId: string;
  /** Tokenized credential the agents transact under — never a raw PAN. */
  visaToken: string;
  authorizedUsd: number;
};

function settlementRail() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_...") || key.length < 20) {
    throw new Error(
      "Settlement rail not configured: STRIPE_SECRET_KEY is missing or a placeholder. " +
        "Add a real sk_test_ key to .env.local and restart the dev server."
    );
  }
  return new Stripe(key);
}

/**
 * Opens the spend mandate: one real tokenized authorization for the whole basket.
 * Agents may then transact against it without further human approval, bounded by
 * the mandate's budget and (our addition) the spatial constraints.
 */
export async function authorizeMandate(opts: {
  amountUsd: number;
  userId: string;
  retailers: string[];
}): Promise<MandateAuthorization> {
  if (!(opts.amountUsd > 0)) {
    throw new Error("Mandate amount must be greater than $0");
  }

  const stripe = settlementRail();
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(opts.amountUsd * 100),
    currency: "usd",
    payment_method: "pm_card_visa",
    payment_method_types: ["card"],
    confirm: true,
    metadata: {
      vic_mandate: "true",
      retailers: opts.retailers.join(","),
      userId: opts.userId,
    },
  });

  if (intent.status !== "succeeded") {
    throw new Error(`Mandate authorization did not succeed (status: ${intent.status})`);
  }

  return {
    mandateId: intent.id,
    visaToken: `vt_${intent.id.slice(3, 15)}`,
    authorizedUsd: opts.amountUsd,
  };
}

const ETA_DAYS = [5, 6, 8, 9];

/**
 * SIMULATED: places one retailer's order against an authorized mandate.
 * Swap this body for the real partner call when merchant integration exists.
 */
export async function placeOrder(opts: {
  mandate: MandateAuthorization;
  retailer: string;
  amountUsd: number;
}): Promise<PurchaseRecord & { etaDays: number }> {
  const { mandate, retailer, amountUsd } = opts;

  // Deterministic per-retailer identifiers so a demo run is stable.
  let h = 0;
  for (const c of retailer + mandate.mandateId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const prefix = retailer.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();

  return {
    orderId: `${prefix}-${1000 + (h % 9000)}`,
    retailer,
    amountUsd,
    visaAuthId: mandate.visaToken,
    etaDays: ETA_DAYS[h % ETA_DAYS.length],
  };
}
