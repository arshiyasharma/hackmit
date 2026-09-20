import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { runCheckout } from "./agent";
import { createRun, getRun } from "./runs";
import type { Basket, BasketLine, LineStatus, Retailer } from "./types";

/**
 * The identity beat, inside the walk.
 *
 * Separate from agent.test.ts because this file mocks the agent registry, and
 * a mock is per-file in vitest. agent.test.ts runs with TAP switched off — no
 * keys in the environment — and proves the walk still completes; this one
 * switches it on and proves the shop is really being asked.
 */

const KEY_ID = "vra-key-walk-test";

const registered = new Map<
  string,
  { agentId: string; agentName: string; publicKeyPem: string; registeredAt: string }
>();

vi.mock("@/lib/tap/registry", () => ({
  lookupKey: (keyId: string) => registered.get(keyId),
  registeredKeyIds: () => [...registered.keys()],
}));

const ENV_KEYS = [
  "TAP_ED25519_PRIVATE_KEY",
  "TAP_ED25519_PUBLIC_KEY",
  "TAP_KEY_ID",
  "TAP_AGENT_ID",
  "TAP_VERIFY_BASE_URL",
  "CHECKOUT_MODE",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  process.env.TAP_ED25519_PRIVATE_KEY = pair.privateKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_ED25519_PUBLIC_KEY = pair.publicKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_KEY_ID = KEY_ID;
  process.env.TAP_AGENT_ID = "visa-room-agent";
  delete process.env.TAP_VERIFY_BASE_URL;
  delete process.env.CHECKOUT_MODE;

  registered.set(KEY_ID, {
    agentId: "visa-room-agent",
    agentName: "VISA Room Agent",
    publicKeyPem: pair.publicKey,
    registeredAt: new Date().toISOString(),
  });
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Product URLs that really belong to the shop selling them. */
const PRODUCT_URL: Partial<Record<Retailer, string>> = {
  ikea: "https://www.ikea.com/us/en/p/lamp-70437814/",
  wayfair: "https://www.wayfair.com/furniture/pdp/frame-123",
  target: "https://www.target.com/p/side-table/-/A-88889999",
};

function line(retailer: Retailer, patch: Partial<BasketLine> = {}): BasketLine {
  const id = crypto.randomUUID();
  return {
    lineId: id,
    placementId: `place-${id.slice(0, 8)}`,
    listingId: "ikea-70437814",
    retailer,
    title: `A thing from ${retailer}`,
    productUrl: PRODUCT_URL[retailer] ?? `https://www.${retailer}.com/p/example`,
    imageUrl: "https://example.com/image.jpg",
    priceMinor: 4200,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

function fourLinesThreeRetailers(): Basket {
  return {
    basketId: crypto.randomUUID(),
    budgetMinor: 125000,
    lines: [line("ikea"), line("wayfair"), line("ikea"), line("target")],
  };
}

describe("the walk, with the agent's identity switched on", () => {
  it("every line carries a tap verdict and every one of them is ok", async () => {
    const run = createRun(fourLinesThreeRetailers());
    await runCheckout(run.runId, { stepMs: 1 });

    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
      expect(l.status.tap).toBeDefined();
      expect(l.status.tap!.ok).toBe(true);
      expect(l.status.tap!.agentId).toBe("visa-room-agent");
      expect(l.status.tap!.tag).toBe("payment");
      expect(l.status.tap!.via).toBe("in-process");
    }
  });

  it("the verdict is on the line from the authorizing beat onward, not only at the end", async () => {
    const run = createRun({
      basketId: crypto.randomUUID(),
      budgetMinor: 125000,
      lines: [line("ikea")],
    });

    let sawVerdictWhileAuthorizing = false;
    const sampler = setInterval(() => {
      const status = getRun(run.runId)?.lines[0].status;
      if (status?.state === "authorizing" && status.tap?.ok) {
        sawVerdictWhileAuthorizing = true;
      }
    }, 2);

    await runCheckout(run.runId, { stepMs: 40 });
    clearInterval(sampler);

    expect(sawVerdictWhileAuthorizing).toBe(true);
  });

  it("a line whose product URL is not that shop's is refused, not quietly placed", async () => {
    const run = createRun({
      basketId: crypto.randomUUID(),
      budgetMinor: 125000,
      // an IKEA line pointing at a Wayfair page: the signature is made for
      // wayfair.com and IKEA's verifier can see it is not for them
      lines: [line("ikea", { productUrl: "https://www.wayfair.com/furniture/pdp/lamp-1" })],
    });

    await runCheckout(run.runId, { stepMs: 1 });

    const status = getRun(run.runId)!.lines[0].status;
    expect(status.state).toBe("failed");
    expect(status.tap).toEqual({
      ok: false,
      reason: "authority-mismatch",
      via: "in-process",
    });
    const failed = status as Extract<LineStatus, { state: "failed" }>;
    expect(failed.reason).toContain("different shop");
  });

  it("the walk contacts no retailer — the only fetch it could make is ours", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const run = createRun(fourLinesThreeRetailers());
    await runCheckout(run.runId, { stepMs: 1 });

    expect(fetchSpy).not.toHaveBeenCalled();
    for (const l of getRun(run.runId)!.lines) {
      expect(l.status.state).toBe("placed");
    }
  });
});

describe("taking our agent out of the registry", () => {
  it("fails every line with unknown-key rather than silently passing", async () => {
    const saved = registered.get(KEY_ID)!;
    registered.delete(KEY_ID);

    try {
      const run = createRun(fourLinesThreeRetailers());
      await runCheckout(run.runId, { stepMs: 1 });

      for (const l of getRun(run.runId)!.lines) {
        expect(l.status.state).toBe("failed");
        expect(l.status.tap?.ok).toBe(false);
        expect(l.status.tap?.reason).toBe("unknown-key");
        const failed = l.status as Extract<LineStatus, { state: "failed" }>;
        expect(failed.reason).toContain("does not recognise this agent");
      }
      expect(getRun(run.runId)!.finishedAt).not.toBeNull();
    } finally {
      registered.set(KEY_ID, saved);
    }
  });
});

describe("TAP_VERIFY_BASE_URL — the same check, one hop away", () => {
  it("POSTs each signature to our own verify endpoint and uses its answer", async () => {
    process.env.TAP_VERIFY_BASE_URL = "http://127.0.0.1:3000/";

    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          headers: init.headers as Record<string, string>,
          body: JSON.parse(init.body as string),
        });
        return Response.json({
          ok: true,
          accepted: true,
          agentId: "visa-room-agent",
          agentName: "VISA Room Agent",
          tag: "payment",
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        });
      })
    );

    try {
      const run = createRun({
        basketId: crypto.randomUUID(),
        budgetMinor: 125000,
        lines: [line("ikea"), line("wayfair")],
      });
      await runCheckout(run.runId, { stepMs: 1 });

      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe("http://127.0.0.1:3000/api/retailer/ikea/verify");
      expect(calls[1].url).toBe("http://127.0.0.1:3000/api/retailer/wayfair/verify");
      expect(calls[0].headers["Signature-Input"]).toContain('tag="payment"');
      expect(calls[0].headers.Signature).toMatch(/^sig1=:/);
      expect(calls[0].body).toEqual({
        targetUrl: PRODUCT_URL.ikea,
        requiredTag: "payment",
      });

      for (const l of getRun(run.runId)!.lines) {
        expect(l.status.state).toBe("placed");
        expect(l.status.tap).toMatchObject({ ok: true, via: "http" });
      }
    } finally {
      delete process.env.TAP_VERIFY_BASE_URL;
    }
  });

  it("fails the line when the shop's verifier cannot be reached — never swallowed", async () => {
    process.env.TAP_VERIFY_BASE_URL = "http://127.0.0.1:9/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    try {
      const run = createRun({
        basketId: crypto.randomUUID(),
        budgetMinor: 125000,
        lines: [line("ikea")],
      });
      await runCheckout(run.runId, { stepMs: 1 });

      const status = getRun(run.runId)!.lines[0].status;
      expect(status.state).toBe("failed");
      expect(status.tap).toEqual({
        ok: false,
        reason: "the shop's verifier did not answer",
        via: "http",
      });
    } finally {
      delete process.env.TAP_VERIFY_BASE_URL;
    }
  });
});
