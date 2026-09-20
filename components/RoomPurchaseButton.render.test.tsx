import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PlacedItem } from "@/types";
import RoomPurchaseButton from "./RoomPurchaseButton";

const { state } = vi.hoisted(() => ({ state: { budgetCents: 10000, items: [] as PlacedItem[] } }));
vi.mock("@/lib/nav", () => ({ useAppNav: () => ({ push: vi.fn(), back: vi.fn(), embedded: true }) }));
vi.mock("@/components/BudgetLeftSheet", () => ({ default: () => null }));
vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return { ...actual, useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});

function render(budgetCents: number, priceCents: number): string {
  state.budgetCents = budgetCents;
  state.items = [{
    id: "lamp", request: "a lamp", category: "lamp", placeholderUrl: "",
    placeholderWidthRatio: 1, placeholderStatus: "ready", options: [], optionsStatus: "ready",
    position: [0, 0, 0], rotationY: 0, scale: 1, listingCutoutUrl: null,
    listingWidthRatio: null, listingCutoutVersion: null, listingCutoutRequestedVersion: null, listingCutoutStatus: "idle", listingCutoutNote: null,
    linkedProductVersion: 0, listingCutoutRequestId: null, placed: true, fit: null, createdAt: 0,
    linkedProduct: { id: "lamp-product", retailer: "IKEA", title: "Lamp", url: "https://www.ikea.com/p/lamp", imageUrl: "", priceCents, currency: "USD", dimsSource: "missing", inStock: true },
  }];
  return renderToStaticMarkup(<RoomPurchaseButton />);
}

describe("room checkout budget boundary", () => {
  it("disables review one cent over and explains the exact overage", () => {
    const markup = render(10000, 10001);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Over budget");
    expect(markup).toContain("$0.01 over your $100 budget");
    expect(markup).toContain("Remove an item or choose a cheaper option");
    expect(markup).toContain("aria-describedby=");
  });

  it.each([10001, 10002])("allows review at or below the budget of %i cents", (budget) => {
    const markup = render(budget, 10001);
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain("Review &amp; buy");
  });

  it.each([NaN, Infinity, -1, 10000.5])("blocks an invalid budget of %s", (budget) => {
    const markup = render(budget, 10000);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Set a valid budget before checking out.");
  });
});
