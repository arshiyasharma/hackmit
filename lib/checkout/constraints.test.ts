import { describe, expect, it } from "vitest";

import { evaluateLine } from "./constraints";
import type { BasketLine, ProfileMm } from "./types";

/** A standard interior door and landing, in millimetres. */
const ROOM: ProfileMm = {
  doorWidthMm: 762,
  doorHeightMm: 2032,
  hallwayWidthMm: 914,
  landingWidthMm: 914,
  ceilingHeightMm: 2438,
};

function line(patch: Partial<BasketLine> = {}): BasketLine {
  return {
    lineId: crypto.randomUUID(),
    placementId: crypto.randomUUID(),
    listingId: "listing-1",
    retailer: "ikea",
    title: "A thing",
    productUrl: "https://www.ikea.com/p/example",
    imageUrl: "",
    priceMinor: 4200,
    currency: "USD",
    dimensionsMm: null,
    quantity: 1,
    ...patch,
  };
}

const noLimits = { profileMm: null, budgetMinor: 0, committedMinor: 0 };

describe("the door", () => {
  it("lets through something that clears it", () => {
    const verdict = evaluateLine(
      line({ dimensionsMm: { w: 600, h: 900, d: 400 } }),
      { ...noLimits, profileMm: ROOM }
    );
    expect(verdict.ok).toBe(true);
  });

  it("holds a sofa that cannot get in, and says which measurement stopped it", () => {
    // 2.4m long, 1.1m deep, 0.9m tall — no rotation gets this through a 762mm door
    const verdict = evaluateLine(
      line({ dimensionsMm: { w: 2400, h: 900, d: 1100 } }),
      { ...noLimits, profileMm: ROOM }
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("no_fit");
    // the sentence is the fit kernel's own, so the person reads a measurement
    // rather than a rule name
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("still buys a tight fit — that is the mover's call, not the agent's", () => {
    // wide enough to need turning, narrow enough that it goes
    const verdict = evaluateLine(
      line({ dimensionsMm: { w: 1200, h: 700, d: 740 } }),
      { ...noLimits, profileMm: ROOM }
    );
    expect(verdict.ok).toBe(true);
  });

  it("buys when the listing published no size — a gap in the data is not a refusal", () => {
    const verdict = evaluateLine(line({ dimensionsMm: null }), {
      ...noLimits,
      profileMm: ROOM,
    });
    expect(verdict.ok).toBe(true);
  });

  it("is switched off, not failing, when no room was measured", () => {
    // the same sofa that fails above
    const verdict = evaluateLine(
      line({ dimensionsMm: { w: 2400, h: 900, d: 1100 } }),
      { ...noLimits, profileMm: null }
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("the budget", () => {
  it("buys while there is room under the cap", () => {
    const verdict = evaluateLine(line({ priceMinor: 4200 }), {
      ...noLimits,
      budgetMinor: 10000,
      committedMinor: 5000,
    });
    expect(verdict.ok).toBe(true);
  });

  it("holds the line that would cross the cap", () => {
    const verdict = evaluateLine(line({ priceMinor: 6000 }), {
      ...noLimits,
      budgetMinor: 10000,
      committedMinor: 5000,
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("over_budget");
  });

  it("counts quantity, not unit price", () => {
    const two = line({ priceMinor: 3000, quantity: 2 });
    expect(
      evaluateLine(two, { ...noLimits, budgetMinor: 5000, committedMinor: 0 }).ok
    ).toBe(false);
    expect(
      evaluateLine(two, { ...noLimits, budgetMinor: 6000, committedMinor: 0 }).ok
    ).toBe(true);
  });

  it("spends exactly to the cap, and not a cent past it", () => {
    const ctx = { ...noLimits, budgetMinor: 10000, committedMinor: 9000 };
    expect(evaluateLine(line({ priceMinor: 1000 }), ctx).ok).toBe(true);
    expect(evaluateLine(line({ priceMinor: 1001 }), ctx).ok).toBe(false);
  });

  it("has no ceiling when the HUD never set one", () => {
    const verdict = evaluateLine(line({ priceMinor: 9_000_00 }), {
      ...noLimits,
      budgetMinor: 0,
      committedMinor: 0,
    });
    expect(verdict.ok).toBe(true);
  });

  it("cannot be spent twice by two lanes — the second sees the first's commitment", () => {
    // what the parallel walk does: each lane asks with what the others have
    // already booked. The ledger is derived, so the second lane cannot reuse it.
    const budgetMinor = 10000;
    const first = line({ priceMinor: 6000 });
    const second = line({ priceMinor: 6000, retailer: "wayfair" });

    expect(evaluateLine(first, { ...noLimits, budgetMinor, committedMinor: 0 }).ok).toBe(
      true
    );
    // the first is now booked; the second asks against it and is turned away
    expect(
      evaluateLine(second, { ...noLimits, budgetMinor, committedMinor: 6000 }).ok
    ).toBe(false);
  });
});

describe("which reason wins", () => {
  it("says the door before the money when both would stop it", () => {
    const verdict = evaluateLine(
      line({ dimensionsMm: { w: 2400, h: 900, d: 1100 }, priceMinor: 99999 }),
      { profileMm: ROOM, budgetMinor: 100, committedMinor: 0 }
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // "it will not fit through your door" is the sentence a person can act on
    expect(verdict.code).toBe("no_fit");
  });
});
