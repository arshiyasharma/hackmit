import type { CartItem, Doorway } from "@/lib/cart-store";

/** Physical space the purchased items have to live in (inches). */
export type Room = {
  width: number;
  depth: number;
  height: number;
};

/** What the approved design called for — agents verify the listing against this. */
export type ExpectedAttributes = {
  colorFamily?: string;
  maxDims?: { h?: number; w?: number; d?: number };
};

/**
 * Spend authority, mirroring Visa Intelligent Commerce's mandate model:
 * an agent may transact autonomously while it stays inside the mandate.
 * `spaceAware` is OUR addition on top of VIC's budget-only authority.
 */
export type SpendMandate = {
  budgetUsd: number;
  perItemMaxUsd?: number;
  /** When true, an item must also pass the space/attribute constraints to buy autonomously. */
  spaceAware: boolean;
};

export type ConstraintCode =
  | "over_budget"
  | "over_item_cap"
  | "doorway_no_fit"
  | "room_no_space"
  | "ceiling_too_low"
  | "color_mismatch"
  | "dimension_mismatch"
  | "missing_data";

export type ConstraintVerdict =
  | { ok: true; notes: string[] }
  | { ok: false; code: ConstraintCode; reason: string };

export type AgentContext = {
  mandate: SpendMandate;
  doorway: Doorway | null;
  room: Room | null;
  expected?: ExpectedAttributes;
  /** Running total already committed by sibling agents this run. */
  committedUsd: number;
  /** Floor area already claimed by sibling agents this run (sq in). */
  committedFootprintSqIn: number;
};

export type PurchaseRecord = {
  orderId: string;
  retailer: string;
  amountUsd: number;
  /** Visa-side authorization reference for the tokenized charge. */
  visaAuthId: string;
};

/** Everything the UI needs to render a swarm live. */
export type AgentEvent =
  | { type: "swarm_start"; retailers: string[]; mandate: SpendMandate }
  | { type: "dispatched"; retailer: string; itemCount: number }
  | { type: "verifying"; retailer: string; title: string }
  | { type: "verified"; retailer: string; title: string; dims: string; color?: string }
  | { type: "constraint_pass"; retailer: string; title: string; notes: string[] }
  | { type: "halted"; retailer: string; title: string; code: ConstraintCode; reason: string }
  | { type: "purchasing"; retailer: string; amountUsd: number }
  | { type: "purchased"; retailer: string; order: PurchaseRecord }
  | { type: "failed"; retailer: string; error: string }
  | {
      type: "swarm_done";
      purchased: PurchaseRecord[];
      halted: { retailer: string; title: string; reason: string }[];
      totalUsd: number;
      visaToken: string;
    };

export type RetailerTask = {
  retailer: string;
  items: CartItem[];
};
