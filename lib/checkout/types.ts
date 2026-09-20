/**
 * The checkout basket, its lines, and what a line is doing right now.
 *
 * TWO RULES, THE SAME TWO AS types/index.ts:
 *   - every dimension is an INTEGER of MILLIMETRES.
 *   - every money value is an INTEGER of MINOR UNITS (cents). Never a float.
 * The conversion to Visa's decimal string ("800.00") happens once, at the
 * payload boundary, and nowhere else.
 *
 * THIS IS THE SERVER'S VOCABULARY AND IT IS NOT types/index.ts's. The room
 * screen speaks `Product.priceCents` / `Product.url` and groups a basket by
 * retailer into `CartItem[]`; this layer speaks `BasketLine.priceMinor` /
 * `productUrl` and tracks state per LINE, because a TAP signature is bound to
 * one line's product URL and a payment credential is pulled for one line at a
 * time. The two meet in exactly one adapter, which is Prompt 10's job. Until
 * then, nothing here imports from `@/types` and nothing there imports from
 * here — one direction of drift is survivable, two is not.
 */

export type Retailer =
  | "amazon"
  | "wayfair"
  | "ikea"
  | "target"
  | "westelm"
  | "cb2"
  | "etsy";

/**
 * One entry in the frozen catalogue: a listing as it was scraped, before
 * anybody put it in a basket. A `BasketLine` is this plus the placement it is
 * linked to and how many of them.
 */
export interface Listing {
  listingId: string;
  retailer: Retailer;
  title: string;
  /** the real retailer page — a judge will tap this */
  productUrl: string;
  imageUrl: string;
  /** integer cents. never a float */
  priceMinor: number;
  currency: "USD";
  /** absent when the listing quoted none. Never guessed. */
  dimensionsMm: { w: number; h: number; d: number } | null;
}

export interface BasketLine {
  lineId: string;            // uuid, stable for the life of the placement
  placementId: string;       // the AR placeholder this line is linked to
  listingId: string;         // the frozen listing
  retailer: Retailer;
  title: string;
  productUrl: string;        // the real retailer page — every line must have one
  imageUrl: string;
  priceMinor: number;        // integer cents. never a float
  currency: "USD";
  dimensionsMm: { w: number; h: number; d: number } | null;
  quantity: number;
}

export interface Basket {
  basketId: string;
  lines: BasketLine[];
  budgetMinor: number;       // the HUD's cap
}

/**
 * What the shop said when the agent showed its Trusted Agent Protocol
 * signature for this line.
 *
 * FLAT AND STRING-TYPED ON PURPOSE. This travels over SSE to a browser, so it
 * carries the shop's answer and nothing that could let a client reconstruct a
 * signature. `reason` is a `TapFailure` most of the time, but not always — a
 * merchant we could not reach is a real outcome and is not in that set.
 */
export interface TapLineVerdict {
  ok: boolean;
  /** who the shop decided we are. Only present when it believed us. */
  agentId?: string;
  agentName?: string;
  /** the operation the signature covered — "browsing" or "payment" */
  tag?: string;
  /** why it was refused, when it was */
  reason?: string;
  /** whether the shop was called in-process or over HTTP. See lib/tap/merchant.ts. */
  via?: "in-process" | "http";
}

/**
 * What happened when the line was authorized, when a real payment provider was
 * asked rather than simulated.
 *
 * `captured` is always false and there is no code path in this repo that could
 * make it true. An authorization is a hold; capture is what moves money.
 */
export interface PaymentLineResult {
  /** Set only when this authorization actually consumed that VIC credential. */
  vicTransactionReferenceId?: string;
  /** "simulated" never appears here — the field is absent instead */
  provider: "acceptance";
  /** straight from Visa: AUTHORIZED, DECLINED, … */
  status: string;
  reconciliationId: string | null;
  /** decimal string, e.g. "120.00" */
  authorizedAmount: string | null;
  approvalCode: string | null;
  /** the id Visa support acts on */
  correlationId: string | null;
  /** the shared test merchant, not ours. Said in the data, not only the pitch. */
  merchant: "shared-test";
  captured: false;
}

/**
 * Where a line has got to, plus the shop's verdict on our identity once we
 * have one.
 *
 * `tap` and `payment` are an intersection rather than fields on each variant so
 * that adding them changed nothing about how `state` discriminates. Each is
 * absent until the line reaches that beat, and absent for the whole run when
 * the feature is not configured — an unconfigured feature is off, not failed.
 */
export type LineStatus = (
  | { state: "pending" }
  | { state: "walking" }               // agent is on the retailer page
  | { state: "authorizing" }
  | { state: "placed"; orderRef: string; mode: "test" | "live" }
  | { state: "failed"; reason: string }
) & { tap?: TapLineVerdict; payment?: PaymentLineResult };

/** A line's id paired with where it has got to. What the run endpoints return. */
export interface RunLine {
  lineId: string;
  status: LineStatus;
}

/**
 * One press of the checkout button.
 *
 * `basket` is FROZEN at creation. The room screen can keep editing while the
 * agent walks; a run has to keep the numbers it actually ran on, or the
 * confirmation reports a total nobody was ever shown.
 */
export interface CheckoutRun {
  runId: string;
  /** Opaque guest-session owner; never included in public run responses. */
  ownerId?: string;
  startedAt?: number;
  instructionCancelled?: boolean;
  /** Server-only locks/results: concurrent retries share one upstream operation. */
  operations?: Map<string, Promise<Response>>;
  basket: Basket;
  /** keyed by lineId, in the basket's order */
  lines: RunLine[];
  createdAt: number;
  /** set once the whole walk is over, terminal either way */
  finishedAt: number | null;
  /**
   * The Visa purchase instruction this run is spending under, when one exists.
   * Written by Prompt 7 from a real `/vacp/v1/instructions` response and NEVER
   * invented — a made-up Visa identifier shown to a Visa judge is the one
   * mistake you cannot recover from.
   */
  instructionId: string | null;
  /**
   * The Visa transaction reference minted for each line, by lineId.
   *
   * An IDENTIFIER, never a credential. A payment credential is held in request
   * scope and allowed to go out of scope; nothing in this repo stores one.
   */
  transactionReferences?: Record<string, string>;
}
