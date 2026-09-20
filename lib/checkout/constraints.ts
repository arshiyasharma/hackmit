/**
 * What the agent is allowed to buy.
 *
 * Visa's mandate answers one question — is there money left. This answers the
 * other one: will the thing physically get into the room. An agent with budget
 * remaining may still not buy a sofa that does not clear the door, and that
 * refusal is the point of the layer.
 *
 * PURE. No I/O, no store, no clock. Everything it needs arrives in `ctx`, which
 * is what lets the parallel walk call it synchronously between two writes.
 *
 * IT BINDS THE AGENT, NOT THE PERSON. A verdict here holds a line and hands it
 * back; the review screen keeps its own advisory warning and its "you can still
 * buy it" override. Nothing in this file can stop a human.
 */

import { fits, profileFromMm, type ProfileMm } from "@/lib/fit";

import { lineTotalMinor } from "./basket";
import type { BasketLine } from "./types";

export type ConstraintCode = "no_fit" | "over_budget";

export type LineVerdict =
  | { ok: true }
  | { ok: false; code: ConstraintCode; reason: string };

export interface ConstraintContext {
  /** null switches the fit constraint off. Off, not failing. */
  profileMm: ProfileMm | null;
  /** the HUD's cap, integer cents. 0 means no cap was set. */
  budgetMinor: number;
  /** integer cents already spoken for by lines this run has let through. */
  committedMinor: number;
}

const OK: LineVerdict = { ok: true };

/**
 * May the agent buy this line right now?
 *
 * Order matters on stage: fit is checked first, because "it will not fit
 * through your door" is a better sentence than "you ran out of money" when both
 * are true, and it is the one the person can actually act on.
 */
export function evaluateLine(
  line: BasketLine,
  ctx: ConstraintContext
): LineVerdict {
  // --- will it get in? ---
  if (ctx.profileMm && line.dimensionsMm) {
    const { w, h, d } = line.dimensionsMm;
    const result = fits([w, h, d], profileFromMm(ctx.profileMm));
    if (result.verdict === "fail") {
      return { ok: false, code: "no_fit", reason: result.reason };
    }
    // "tight" still buys. The movers may manage it, and that is the person's
    // call to make, not ours to pre-empt.
  }
  // A listing that quoted no size is not a refusal. `dimensionsMm: null` means
  // the shop never published one, which is a gap in the data and not a reason
  // to refuse to shop — the same contract `fitFor` keeps on the review screen.

  // --- is there money left? ---
  // budgetMinor === 0 means the HUD never set a cap. No cap, no ceiling.
  if (ctx.budgetMinor > 0) {
    const after = ctx.committedMinor + lineTotalMinor(line);
    if (after > ctx.budgetMinor) {
      return {
        ok: false,
        code: "over_budget",
        reason: "the budget was already spent by the time the agent got here",
      };
    }
  }

  return OK;
}

/** The sentence a person reads on a held line. */
export function holdSentence(retailer: string, verdict: LineVerdict): string {
  if (verdict.ok) return "";
  if (verdict.code === "no_fit") {
    return `Left at ${retailer} — ${verdict.reason}`;
  }
  return `Left at ${retailer} — ${verdict.reason}.`;
}
