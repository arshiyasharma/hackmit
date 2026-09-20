import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/checkout/route";
import { runCheckout } from "@/lib/checkout/agent";
import { getRun } from "@/lib/checkout/runs";
import type { Basket, BasketLine } from "@/lib/checkout/types";

/**
 * The checkout entry point, called the way Next calls it. No server is started
 * and no port is bound — the handler is a function that takes a Request.
 *
 * The walk is stubbed. This file is about what the route accepts, what it
 * refuses and how fast it answers; `lib/checkout/agent.test.ts` is about what
 * the walk does. Letting the real ten-second walk start eight times here would
 * make the suite slow and tell us nothing new.
 */

vi.mock("@/lib/checkout/agent", () => ({
  runCheckout: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.mocked(runCheckout).mockClear();
});

function line(patch: Partial<BasketLine> = {}): BasketLine {
  return {
    lineId: `line-${Math.random().toString(36).slice(2, 8)}`,
    placementId: `place-${Math.random().toString(36).slice(2, 8)}`,
    listingId: "ikea-70437814",
    retailer: "ikea",
    title: "BARLAST Floor lamp",
    productUrl: "https://www.ikea.com/us/en/p/barlast-floor-lamp-black-white-70437814/",
    imageUrl: "https://www.ikea.com/example.jpg",
    priceMinor: 12000,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

function basket(lines: BasketLine[], budgetMinor = 125000): Basket {
  return { basketId: "basket-1", lines, budgetMinor };
}

/** Next hands the handler a NextRequest; a plain Request is the same shape here. */
function post(body: unknown) {
  const request = new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as Parameters<typeof POST>[0]);
}

describe("POST /api/checkout", () => {
  it("takes a two-line basket, answers 200 with a runId, and does it in under 50 ms", async () => {
    const started = performance.now();
    const res = await post({ basket: basket([line(), line({ priceMinor: 8999 })]) });
    const elapsed = performance.now() - started;

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      lines: Array<{ lineId: string; status: { state: string } }>;
    };
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.lines).toHaveLength(2);
    for (const l of body.lines) expect(l.status.state).toBe("pending");
    expect(elapsed).toBeLessThan(50);
  });

  it("starts the walk for the run it created, without waiting for it", async () => {
    const res = await post({ basket: basket([line()]) });
    const { runId } = (await res.json()) as { runId: string };
    expect(runCheckout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runCheckout).mock.calls[0][0]).toBe(runId);
  });

  it("does not start a walk for a basket it refused", async () => {
    await post({ basket: basket([]) });
    expect(runCheckout).not.toHaveBeenCalled();
  });

  it("freezes the basket on the run it created", async () => {
    const res = await post({ basket: basket([line({ priceMinor: 4200 })]) });
    const { runId } = (await res.json()) as { runId: string };
    const run = getRun(runId);
    expect(run).toBeDefined();
    expect(run?.basket.lines[0].priceMinor).toBe(4200);
    expect(run?.finishedAt).toBeNull();
    expect(run?.instructionId).toBeNull();
  });

  it("refuses an empty basket in words a person can read aloud", async () => {
    const res = await post({ basket: basket([]) });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe(
      "Your basket is empty. Link a listing to something standing in your room first."
    );
  });

  it("refuses a line with no product URL and names the item", async () => {
    const res = await post({
      basket: basket([line(), line({ title: "A tall lamp", productUrl: "" })]),
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("A tall lamp");
    expect(error).toContain("no link to the shop that sells it");
    // nothing technical leaks into the sentence
    expect(error).not.toMatch(/undefined|null|productUrl|400/);
  });

  it("refuses a basket over the budget, and says by how much", async () => {
    const res = await post({
      basket: basket([line({ priceMinor: 140000 })], 125000),
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("$1,400.00");
    expect(error).toContain("$150.00");
    expect(error).toContain("$1,250.00");
  });

  it("keeps an over-budget basket blocked when the caller acknowledges it", async () => {
    const res = await post({
      basket: basket([line({ priceMinor: 140000 })], 125000),
      acknowledgedOverBudget: true,
    });
    expect(res.status).toBe(400);
    expect(runCheckout).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a basket at all", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ basket: "nope" })).status).toBe(400);
  });

  it("refuses a line priced in something other than whole US cents", async () => {
    const float = await post({ basket: basket([line({ priceMinor: 120.5 })]) });
    expect(float.status).toBe(400);
    expect(((await float.json()) as { error: string }).error).toContain("no price on it");
  });
});
