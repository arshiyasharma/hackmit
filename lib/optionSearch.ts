import type { PlacedItem } from "@/types";

type BudgetState = { budgetCents: number; items: ReadonlyArray<Pick<PlacedItem, "id" | "linkedProduct">> };

/** Replacing this item's listing releases its existing price back to the budget. */
export function budgetForItem(state: BudgetState, itemId?: string): number {
  return state.budgetCents - state.items.reduce((spent, item) =>
    spent + (item.id === itemId ? 0 : item.linkedProduct?.priceCents ?? 0), 0);
}

/** Changes in available money are a new search even when the words are unchanged. */
export function optionSearchKey(query: string, budgetRemainingCents: number): string {
  return JSON.stringify([query, budgetRemainingCents]);
}

/** Ready results without their search metadata must be revalidated after remount. */
export function shouldRefreshOptions(
  status: PlacedItem["optionsStatus"],
  previousKey: string | undefined,
  currentKey: string,
): boolean {
  if (previousKey === undefined) return status === "ready";
  return previousKey !== currentKey;
}
