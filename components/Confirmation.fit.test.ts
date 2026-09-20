import { describe, expect, it } from "vitest";
import { confirmationFitSummary } from "./Confirmation";
import type { CartItem, Product, Profile } from "@/types";

const profile: Profile = {
  doorWidthMm: 850, doorHeightMm: 2100, hallwayWidthMm: 1800,
  landingWidthMm: 1800, ceilingHeightMm: 2500, budgetCents: 50000, units: "mm",
  measured: { doorWidthMm: true, doorHeightMm: true, hallwayWidthMm: true, landingWidthMm: true, ceilingHeightMm: true },
};
const item = (patch: Partial<Product> = {}, quantity = 1): CartItem => ({
  id: "line", itemId: "item", quantity, addedAt: 0,
  product: { id: "p1", title: "Brass floor lamp", retailer: "Target", url: "https://www.target.com/p/lamp", currency: "USD", priceCents: 9900, dimsMm: [300, 1500, 300], dimsSource: "quoted", inStock: true, ...patch },
});

describe("checkout completion preserves delivery-fit uncertainty", () => {
  it("never turns default unmeasured profile values into clearance", () => {
    const summary = confirmationFitSummary([item()], { ...profile, measured: {} });
    expect(summary).toContain("Delivery fit is still unverified for 1 item");
    expect(summary).not.toMatch(/passes|clears|clear the/);
  });
  it.each(["estimated", "approx", "missing"] as const)("does not assert clearance with %s product size", (dimsSource) => {
    expect(confirmationFitSummary([item({ dimsSource })], profile)).toContain("Delivery fit is still unverified");
  });
  it("keeps a listing with no dimensions visibly unverified", () => {
    expect(confirmationFitSummary([item({ dimsMm: undefined })], profile)).toContain("Delivery fit is still unverified");
  });
  it("describes a complete measured pass as a model result", () => {
    expect(confirmationFitSummary([item()], profile)).toBe("1 item passes the modeled doorway, turn, and headroom checks.");
  });
  it("reports tight and failed results instead of counting both as clear", () => {
    const summary = confirmationFitSummary([item({ dimsMm: [800, 1500, 800] }), item({ dimsMm: [1000, 1500, 1000] })], profile);
    expect(summary).toContain("1 item has tight modeled clearance");
    expect(summary).toContain("1 item has a modeled clearance risk");
    expect(summary).not.toContain("passes");
  });
  it("separates mixed quantities and never says all passed", () => {
    const summary = confirmationFitSummary([item({}, 2), item({ dimsSource: "approx" }, 3)], profile);
    expect(summary).toContain("2 items pass the modeled");
    expect(summary).toContain("unverified for 3 items");
    expect(summary).not.toContain("All");
  });
  it("does not summarize an empty basket", () => {
    expect(confirmationFitSummary([], profile)).toBeNull();
  });
});
