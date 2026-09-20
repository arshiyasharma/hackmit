import { describe, expect, it } from "vitest";

import {
  deriveShopRows,
  LINE_STATE_WORDS,
  LINE_TERMINAL,
  readLineStatus,
  type SettleableLine,
} from "./lineView";
import type { LineStatus } from "./types";

/**
 * The frames below are COPIED FROM A REAL RUN — the SSE output of
 * `/api/checkout/{runId}/stream` with TAP configured and
 * `PAYMENT_PROVIDER=acceptance`. If the server's shape ever changes, this is
 * the file that notices.
 */

const WALKING = { state: "walking" };

const AUTHORIZING = {
  state: "authorizing",
  tap: {
    ok: true,
    agentId: "visa-room-agent",
    agentName: "VISA Room Agent",
    tag: "payment",
    via: "in-process",
  },
};

const PLACED = {
  state: "placed",
  orderRef: "TEST-IKEA-6F3DC970",
  mode: "test",
  tap: { ok: true, agentId: "visa-room-agent", tag: "payment", via: "in-process" },
  payment: {
    provider: "acceptance",
    status: "AUTHORIZED",
    reconciliationId: "7898719049626280604805",
    authorizedAmount: "120.00",
    approvalCode: "660490",
    merchant: "shared-test",
    captured: false,
  },
};

const REFUSED = {
  state: "failed",
  reason: "ikea would not take this order — that signature was made for a different shop.",
  tap: { ok: false, reason: "authority-mismatch", via: "in-process" },
};

describe("readLineStatus — real frames from a real run", () => {
  it("reads a plain state with nothing attached", () => {
    expect(readLineStatus(WALKING)).toEqual({
      state: "walking",
      orderRef: null,
      reason: null,
      tap: null,
      payment: null,
    });
  });

  it("reads the identity beat", () => {
    const view = readLineStatus(AUTHORIZING)!;
    expect(view.state).toBe("authorizing");
    expect(view.tap).toEqual({ ok: true, agentId: "visa-room-agent", reason: undefined });
  });

  it("reads a placed line with its order reference and its authorization", () => {
    const view = readLineStatus(PLACED)!;
    expect(view.state).toBe("placed");
    expect(view.orderRef).toBe("TEST-IKEA-6F3DC970");
    expect(view.tap?.ok).toBe(true);
    expect(view.payment).toEqual({
      status: "AUTHORIZED",
      reconciliationId: "7898719049626280604805",
      authorizedAmount: "120.00",
    });
  });

  it("reads a refusal, with the reason the merchant gave", () => {
    const view = readLineStatus(REFUSED)!;
    expect(view.state).toBe("failed");
    expect(view.tap).toEqual({ ok: false, agentId: undefined, reason: "authority-mismatch" });
    expect(view.reason).toContain("different shop");
  });

  it("never renders a credential — only what the server already decided to send", () => {
    const view = readLineStatus(PLACED)!;
    const flat = JSON.stringify(view);
    expect(flat).not.toContain("captured");
    expect(flat).not.toContain("provider");
    expect(flat).not.toContain("approvalCode");
  });
});

describe("readLineStatus — frames it refuses", () => {
  it("is null for anything that is not a status", () => {
    expect(readLineStatus(null)).toBeNull();
    expect(readLineStatus("placed")).toBeNull();
    expect(readLineStatus({})).toBeNull();
    expect(readLineStatus({ state: "shipped" })).toBeNull();
  });

  it("treats an unreadable tap verdict as a refusal, never a pass", () => {
    expect(readLineStatus({ state: "placed", tap: { ok: "yes" } })?.tap).toEqual({
      ok: false,
      agentId: undefined,
      reason: undefined,
    });
  });

  it("ignores a tap or payment that is not an object", () => {
    const view = readLineStatus({ state: "placed", tap: "ok", payment: 1 })!;
    expect(view.tap).toBeNull();
    expect(view.payment).toBeNull();
  });
});

describe("the state vocabulary matches the server's", () => {
  it("has a word for every state LineStatus can be in", () => {
    const states: Array<LineStatus["state"]> = [
      "pending",
      "walking",
      "authorizing",
      "placed",
      "failed",
    ];
    for (const state of states) {
      expect(LINE_STATE_WORDS[state]).toBeTruthy();
      expect(readLineStatus({ state })?.state).toBe(state);
    }
  });

  it("knows which states a line never leaves", () => {
    expect([...LINE_TERMINAL].sort()).toEqual(["failed", "held", "placed"]);
  });
});

describe("deriveShopRows — the bug that said 'Nothing ran.'", () => {
  const line = (patch: Partial<SettleableLine> = {}): SettleableLine => ({
    shopName: "IKEA",
    url: "https://www.ikea.com/p/1",
    quantity: 1,
    priceCents: 12000,
    state: "placed",
    orderRef: "TEST-IKEA-1",
    reason: null,
    ...patch,
  });

  it("a completed run settles to one row per shop, never to nothing", () => {
    const rows = deriveShopRows([
      line(),
      line({ shopName: "Wayfair", orderRef: "TEST-WAYFAIR-1", priceCents: 3500, quantity: 2 }),
      line({ orderRef: "TEST-IKEA-2", priceCents: 1900 }),
      line({ shopName: "Target", orderRef: "TEST-TARGET-1", priceCents: 8900 }),
    ]);

    // this is the assertion that would have caught it: four placed lines
    // across three shops must never derive to zero rows
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.retailer)).toEqual(["IKEA", "Wayfair", "Target"]);
    expect(rows.every((r) => r.state === "ordered")).toBe(true);
  });

  it("an empty run is the only thing that settles to nothing", () => {
    expect(deriveShopRows([])).toEqual([]);
  });

  it("adds up the quantity and the money per shop", () => {
    const [ikea] = deriveShopRows([
      line({ priceCents: 12000, quantity: 2 }),
      line({ priceCents: 1900, quantity: 1 }),
    ]);
    expect(ikea.itemCount).toBe(3);
    expect(ikea.subtotalCents).toBe(12000 * 2 + 1900);
  });

  it("a shop that half-worked is failed, not ordered — a human has to finish it", () => {
    const [ikea] = deriveShopRows([
      line(),
      line({ state: "failed", orderRef: null, reason: "the shop refused the signature" }),
    ]);
    expect(ikea.state).toBe("failed");
    expect(ikea.error).toBe("the shop refused the signature");
  });

  it("a shop the agent stood down at is held, not failed", () => {
    const [ikea] = deriveShopRows([
      line(),
      line({
        state: "held",
        orderRef: null,
        reason: "Needs 812 mm of clear width; your door is 762.",
      }),
    ]);

    // nothing broke here — drawing it as a failure would send a person
    // chasing a bug that does not exist
    expect(ikea.state).toBe("held");
    expect(ikea.error).toBeNull();
    expect(ikea.heldReason).toBe("Needs 812 mm of clear width; your door is 762.");
    expect(ikea.heldCount).toBe(1);
  });

  it("counts held quantity, not held lines", () => {
    const [ikea] = deriveShopRows([
      line({ state: "held", orderRef: null, reason: "too wide", quantity: 3 }),
    ]);
    expect(ikea.heldCount).toBe(3);
  });

  it("a real failure outranks a hold — the broken thing is the urgent one", () => {
    const [ikea] = deriveShopRows([
      line({ state: "held", orderRef: null, reason: "too wide" }),
      line({ state: "failed", orderRef: null, reason: "the shop refused the signature" }),
    ]);
    expect(ikea.state).toBe("failed");
    expect(ikea.error).toBe("the shop refused the signature");
    // the hold is still reported, just not as the headline
    expect(ikea.heldReason).toBe("too wide");
  });

  it("carries the TEST- order reference and never claims real work", () => {
    const [ikea] = deriveShopRows([line()]);
    expect(ikea.orderRef).toBe("TEST-IKEA-1");
    expect(ikea.simulated).toBe(true);
    expect(ikea.mode).toBe("test");
  });

  it("the mode is what stops the confirmation saying 'Ordered.'", () => {
    // Confirmation.tsx reads `mode !== "live"` to decide the headline, so a
    // settled row must always carry "test" — the type pins it and this pins
    // the value, because a row that ever said "live" would headline a test run
    // as an order.
    expect(deriveShopRows([line()]).map((r) => r.mode)).toEqual(["test"]);
  });
});
