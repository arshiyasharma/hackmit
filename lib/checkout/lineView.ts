import type { LineStatus } from "./types";

/**
 * Reading the server's `LineStatus` off the wire.
 *
 * Pure, and deliberately not inside the component: this is the seam between
 * `/api/checkout/{runId}/stream` and what a row draws, and a seam is worth
 * testing without mounting React. Everything it returns is already safe to
 * render — no signature, no credential, nothing a client could misuse.
 *
 * IT VALIDATES RATHER THAN TRUSTS. The payload comes from our own server, but
 * a stream that reconnects mid-deploy can hand back a shape from the previous
 * build, and a row that renders `undefined` in front of a judge is worse than
 * a row that ignores one bad frame.
 */

export type LineViewState = LineStatus["state"];

export interface TapView {
  ok: boolean;
  agentId?: string;
  reason?: string;
}

export interface PaymentView {
  status: string;
  authorizedAmount: string | null;
  reconciliationId: string | null;
}

export interface LineStatusView {
  state: LineViewState;
  orderRef: string | null;
  reason: string | null;
  tap: TapView | null;
  payment: PaymentView | null;
}

const STATES: ReadonlySet<string> = new Set<LineViewState>([
  "pending",
  "walking",
  "authorizing",
  "placed",
  "failed",
]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Null means "a frame I could not read" — the caller keeps what it had. */
export function readLineStatus(raw: unknown): LineStatusView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.state !== "string" || !STATES.has(r.state)) return null;

  const tapRaw = r.tap && typeof r.tap === "object" ? (r.tap as Record<string, unknown>) : null;
  const payRaw =
    r.payment && typeof r.payment === "object"
      ? (r.payment as Record<string, unknown>)
      : null;

  return {
    state: r.state as LineViewState,
    orderRef: str(r.orderRef),
    reason: str(r.reason),
    tap: tapRaw
      ? {
          // only an explicit true is a pass. An unreadable verdict is a refusal.
          ok: tapRaw.ok === true,
          agentId: str(tapRaw.agentId) ?? undefined,
          reason: str(tapRaw.reason) ?? undefined,
        }
      : null,
    payment: payRaw
      ? {
          status: str(payRaw.status) ?? "",
          authorizedAmount: str(payRaw.authorizedAmount),
          reconciliationId: str(payRaw.reconciliationId),
        }
      : null,
  };
}

/** What a line's state says on screen. Plain words, present tense. */
export const LINE_STATE_WORDS: Readonly<Record<LineViewState, string>> = {
  pending: "waiting",
  walking: "on the product page",
  authorizing: "authorising",
  placed: "test order placed",
  held: "left for you to decide",
  failed: "couldn't complete",
};

export const LINE_TERMINAL: ReadonlySet<LineViewState> = new Set([
  "placed",
  "held",
  "failed",
]);

/* ------------------------------------------------- settling a finished run */

/**
 * One shop's summary, derived from its lines once they have all stopped.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT INLINE IN THE COMPONENT. It used to be,
 * and it was fed by reading state out of a `setState` updater — which React
 * does not invoke synchronously. The read usually came back empty, so a run
 * where four lines went green settled to zero rows and the confirmation screen
 * said "Nothing ran." Pulling it out means the arithmetic is testable without
 * mounting React, and the component's only job is to hand it the lines.
 */
export interface SettledShopRow {
  retailer: string;
  url: string;
  itemCount: number;
  subtotalCents: number;
  currency: string;
  state: "ordered" | "held" | "failed";
  simulated: true;
  orderRef: string | null;
  error: string | null;
  /** why the agent stood down, when it did. Separate from `error` on purpose. */
  heldReason: string | null;
  /** how many of this shop's lines the agent declined to buy */
  heldCount: number;
  mode: "test";
}

export interface SettleableLine {
  shopName: string;
  url: string;
  quantity: number;
  priceCents: number;
  state: LineViewState;
  orderRef: string | null;
  reason: string | null;
}

/**
 * Group the lines by shop and say what became of each shop.
 *
 * A shop counts as `ordered` only when EVERY one of its lines was placed. A
 * genuine failure still outranks everything: a shop that half-worked needs a
 * human, and reporting it as done is how a partial failure gets missed.
 *
 * `held` sits between the two. Nothing broke — the agent looked at the door or
 * the budget and stood down — so a shop whose only non-placed lines were held
 * must not wear the failure colour. It is a decision waiting for its owner, and
 * the row says how many and why.
 */
export function deriveShopRows(
  lines: readonly SettleableLine[],
  currency = "USD"
): SettledShopRow[] {
  const byShop = new Map<string, SettleableLine[]>();
  for (const line of lines) {
    const existing = byShop.get(line.shopName);
    if (existing) existing.push(line);
    else byShop.set(line.shopName, [line]);
  }

  return [...byShop.entries()].map(([retailer, shopLines]) => {
    const placed = shopLines.filter((l) => l.state === "placed");
    const failed = shopLines.filter((l) => l.state === "failed");
    const held = shopLines.filter((l) => l.state === "held");

    // a real failure outranks a hold; a hold outranks nothing but success
    const state: SettledShopRow["state"] =
      placed.length === shopLines.length
        ? "ordered"
        : failed.length > 0
          ? "failed"
          : held.length > 0
            ? "held"
            : "failed";

    return {
      retailer,
      url: shopLines[0]?.url ?? "",
      itemCount: shopLines.reduce((n, l) => n + l.quantity, 0),
      subtotalCents: shopLines.reduce((n, l) => n + l.priceCents * l.quantity, 0),
      currency,
      state,
      // the server contacted no shop and says so. Never claim otherwise.
      simulated: true,
      orderRef: placed[0]?.orderRef ?? null,
      error: failed[0]?.reason ?? null,
      heldReason: held[0]?.reason ?? null,
      heldCount: held.reduce((n, l) => n + l.quantity, 0),
      mode: "test",
    };
  });
}
