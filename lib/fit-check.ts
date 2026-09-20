import type { FitStatus } from "./cart-store";

/**
 * Will this item fit through the user's doorway?
 * Pure function — run it before addItem() and store the result as CartItem.fitStatus.
 *
 * `item` dimensions and `doorway` must be in the SAME unit (inches). Convert upstream.
 */
export function checkFit(
  item: { h: number; w: number; d: number },
  doorway: { width: number; height: number }
): FitStatus {
  // Two smallest dimensions of the item — the cross-section that goes through first.
  const [d1, d2] = [item.h, item.w, item.d].sort((a, b) => a - b);
  const straightFits = d1 <= doorway.width && d2 <= doorway.height;
  if (straightFits) return "ok";

  // Angled through the frame — compare diagonals, with a safety margin.
  const itemDiagonal = Math.sqrt(item.w ** 2 + item.h ** 2);
  const doorDiagonal = Math.sqrt(doorway.width ** 2 + doorway.height ** 2) * 0.87;
  return itemDiagonal <= doorDiagonal ? "tight" : "no_fit";
}
