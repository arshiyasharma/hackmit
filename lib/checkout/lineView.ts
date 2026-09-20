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
  failed: "couldn't complete",
};

export const LINE_TERMINAL: ReadonlySet<LineViewState> = new Set(["placed", "failed"]);
