import { describe, expect, it } from "vitest";
import { budgetForItem, optionSearchKey, shouldRefreshOptions } from "./optionSearch";
import type { PlacedItem } from "@/types";

const linked = (id: string, priceCents: number) => ({ id, linkedProduct: { priceCents } }) as Pick<PlacedItem, "id" | "linkedProduct">;

describe("option search budget", () => {
  it("a budget edit makes the same words a new request", () => {
    const state = { budgetCents: 60000, items: [linked("chair", 20000)] };
    const original = optionSearchKey("brass floor lamp", budgetForItem(state, "lamp"));
    const edited = optionSearchKey("brass floor lamp", budgetForItem({ ...state, budgetCents: 30000 }, "lamp"));
    expect(original).not.toBe(edited);
    expect(budgetForItem({ ...state, budgetCents: 30000 }, "lamp")).toBe(10000);
  });
  it("replacing a linked listing has its own cost available, preventing a false over-budget search", () => {
    const state = { budgetCents: 60000, items: [linked("chair", 20000), linked("lamp", 15000)] };
    expect(budgetForItem(state, "lamp")).toBe(40000);
    expect(budgetForItem(state, "new-item")).toBe(25000);
  });
  it("linking the current item does not trigger a redundant search", () => {
    const before = { budgetCents: 60000, items: [linked("chair", 20000)] };
    const after = { ...before, items: [...before.items, linked("lamp", 15000)] };
    expect(optionSearchKey("lamp", budgetForItem(before, "lamp"))).toBe(optionSearchKey("lamp", budgetForItem(after, "lamp")));
  });
  it("another item's link or unlink changes available money, including an over-budget room", () => {
    const state = { budgetCents: 10000, items: [linked("chair", 20000)] };
    expect(budgetForItem(state, "lamp")).toBe(-10000);
    expect(budgetForItem({ ...state, items: [] }, "lamp")).toBe(10000);
  });
});


describe("option results after remount", () => {
  it("revalidates persisted ready results even when request metadata was lost", () => {
    const lowerBudget = optionSearchKey("brass floor lamp", 10000);
    expect(shouldRefreshOptions("ready", undefined, lowerBudget)).toBe(true);
    // Once that request completes, the same snapshot stays deduplicated.
    expect(shouldRefreshOptions("ready", lowerBudget, lowerBudget)).toBe(false);
  });
  it("does not duplicate an initial pending request or repeatedly retry a failed one", () => {
    const key = optionSearchKey("floor lamp", 60000);
    expect(shouldRefreshOptions("pending", undefined, key)).toBe(false);
    expect(shouldRefreshOptions("failed", undefined, key)).toBe(false);
  });
  it("a further budget edit still refreshes known results", () => {
    const oldKey = optionSearchKey("floor lamp", 60000);
    const newKey = optionSearchKey("floor lamp", 10000);
    expect(shouldRefreshOptions("ready", oldKey, newKey)).toBe(true);
  });
});
