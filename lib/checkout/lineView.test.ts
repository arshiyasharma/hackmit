import { describe, expect, it } from "vitest";

import { LINE_STATE_WORDS, LINE_TERMINAL, readLineStatus } from "./lineView";
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
    expect([...LINE_TERMINAL].sort()).toEqual(["failed", "placed"]);
  });
});
