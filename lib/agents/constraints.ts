import type { CartItem } from "@/lib/cart-store";
import { checkFit } from "@/lib/fit-check";
import type { AgentContext, ConstraintVerdict } from "./types";

/** Fraction of floor area that must stay walkable — furniture may claim the rest. */
const WALKABLE_RESERVE = 0.4;

function sameColorFamily(actual: string, expected: string) {
  const norm = (s: string) => s.toLowerCase().trim();
  const a = norm(actual);
  const e = norm(expected);
  return a === e || a.includes(e) || e.includes(a);
}

/**
 * The full authority check an agent must clear before it may transact autonomously.
 *
 * Visa Intelligent Commerce's own mandate covers spend only. Everything after the
 * budget checks is our added *spatial* authority: an agent with money available
 * still may not buy something that cannot physically get into, or fit inside, the room.
 */
export function evaluateItem(item: CartItem, ctx: AgentContext): ConstraintVerdict {
  const notes: string[] = [];
  const { mandate, doorway, room, expected } = ctx;

  // --- Data completeness: never buy on missing dimensions. ---
  const d = item.dimensions;
  if (!d || [d.h, d.w, d.d].some((n) => typeof n !== "number" || !isFinite(n) || n <= 0)) {
    return {
      ok: false,
      code: "missing_data",
      reason: `no verified dimensions for "${item.title}" — cannot confirm it fits`,
    };
  }

  // --- VIC mandate: spend authority ---
  if (mandate.perItemMaxUsd != null && item.price > mandate.perItemMaxUsd) {
    return {
      ok: false,
      code: "over_item_cap",
      reason: `$${item.price} exceeds the $${mandate.perItemMaxUsd} per-item cap`,
    };
  }

  const runningTotal = ctx.committedUsd + item.price;
  if (runningTotal > mandate.budgetUsd) {
    return {
      ok: false,
      code: "over_budget",
      reason: `$${runningTotal.toFixed(2)} would exceed the $${mandate.budgetUsd} mandate`,
    };
  }
  notes.push(`within mandate · $${runningTotal.toFixed(2)} of $${mandate.budgetUsd}`);

  // Everything below is the space-aware layer; skip only if explicitly disabled.
  if (!mandate.spaceAware) return { ok: true, notes };

  // --- Can it physically get in the door? ---
  if (!doorway) {
    return {
      ok: false,
      code: "missing_data",
      reason: "no doorway measurements on file — cannot confirm delivery access",
    };
  }
  const fit = checkFit(d, doorway);
  if (fit === "no_fit") {
    return {
      ok: false,
      code: "doorway_no_fit",
      reason: `${d.w}×${d.h}in will not pass a ${doorway.width}×${doorway.height}in doorway`,
    };
  }
  notes.push(fit === "tight" ? "clears doorway (tight)" : "clears doorway");

  // --- Does it fit inside the room? ---
  if (room) {
    if (d.h > room.height) {
      return {
        ok: false,
        code: "ceiling_too_low",
        reason: `${d.h}in tall exceeds the ${room.height}in ceiling`,
      };
    }

    const usableFloor = room.width * room.depth * (1 - WALKABLE_RESERVE);
    const footprint = d.w * d.d;
    const claimed = ctx.committedFootprintSqIn + footprint;
    if (claimed > usableFloor) {
      return {
        ok: false,
        code: "room_no_space",
        reason: `would claim ${Math.round(claimed)}sq in of ${Math.round(usableFloor)}sq in usable floor`,
      };
    }
    notes.push(`fits room · ${Math.round(claimed)}/${Math.round(usableFloor)}sq in floor used`);
  }

  // --- Does the listing match the approved design? ---
  if (expected?.colorFamily && item.color && !sameColorFamily(item.color, expected.colorFamily)) {
    return {
      ok: false,
      code: "color_mismatch",
      reason: `listing is ${item.color}, design called for ${expected.colorFamily}`,
    };
  }
  if (expected?.colorFamily && item.color) notes.push(`color matches (${item.color})`);

  const max = expected?.maxDims;
  if (max) {
    const over = (["h", "w", "d"] as const).find((k) => max[k] != null && d[k] > (max[k] as number));
    if (over) {
      return {
        ok: false,
        code: "dimension_mismatch",
        reason: `${over}=${d[over]}in exceeds the approved ${max[over]}in`,
      };
    }
    notes.push("dimensions match approved design");
  }

  return { ok: true, notes };
}

export function footprintOf(item: CartItem) {
  return item.dimensions.w * item.dimensions.d;
}
