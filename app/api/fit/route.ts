import type { NextRequest } from "next/server";

import { fits, type FitResult, type Profile as KernelProfile } from "@/lib/fit";
import type { Carton } from "@/types";

/**
 * POST /api/fit — will the listing you just linked get into the room?
 *
 * In:  { carton | dimsMm, profile, flatPack? }
 * Out: { fit: FitResult | null, carton, checked, reason? }
 *
 * THE MATH IS NOT HERE. lib/fit.ts decides; this route only hands it the
 * numbers and passes its answer back untouched — no rounding, no rewording of
 * `reason`, which is the sentence that gets said out loud on stage.
 *
 * NO DIMENSIONS MEANS NO VERDICT. `fit` comes back null and `checked` false,
 * and the badge reads "Can't check — no dimensions listed". Inventing a carton
 * to fill the gap would destroy the one rigorous thing in the product.
 *
 * It never 500s. A bad body answers 200 with fit null, because a linked item
 * with an unknown verdict is a working screen and an exception is not.
 */

export const maxDuration = 15;

/**
 * The same starting measurements as DEFAULT_PROFILE in lib/store.ts, repeated
 * here because lib/store.ts is a "use client" zustand module and must not be
 * imported into a route handler. 762 × 2032 mm is the common US interior door;
 * 914 mm is the residential minimum for a hallway and a landing.
 */
const DEFAULTS: KernelProfile = {
  doorW: 762,
  doorH: 2032,
  hallW: 914,
  stairW: 914,
  ceiling: 2438,
};

function mm(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Accepts the kernel's short names or types/index.ts's long ones. */
function toKernelProfile(raw: unknown, flatPack: boolean | undefined): KernelProfile {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    doorW: mm(p.doorW ?? p.doorWidthMm) ?? DEFAULTS.doorW,
    doorH: mm(p.doorH ?? p.doorHeightMm) ?? DEFAULTS.doorH,
    hallW: mm(p.hallW ?? p.hallwayWidthMm) ?? DEFAULTS.hallW,
    stairW: mm(p.stairW ?? p.landingWidthMm ?? p.stairWidthMm) ?? DEFAULTS.stairW,
    ceiling: mm(p.ceiling ?? p.ceilingHeightMm) ?? DEFAULTS.ceiling,
    flatPack:
      flatPack === true
        ? true
        : p.flatPack === true
          ? true
          : undefined,
  };
}

/** [width, height, depth] in millimetres, or null when the listing quoted none. */
function toCarton(body: Record<string, unknown>): Carton | null {
  const candidate =
    body.carton ??
    body.dimsMm ??
    (body.product && typeof body.product === "object"
      ? (body.product as Record<string, unknown>).dimsMm
      : undefined);

  if (!Array.isArray(candidate) || candidate.length !== 3) return null;
  const trio = candidate.map((v) => mm(v));
  if (trio.some((v) => v === undefined)) return null;
  return [trio[0] as number, trio[1] as number, trio[2] as number];
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({
      fit: null,
      carton: null,
      checked: false,
      reason: "Send the listing's dimensions in millimetres to check the fit.",
    });
  }

  const carton = toCarton(body);
  if (!carton) {
    return Response.json({
      fit: null,
      carton: null,
      checked: false,
      reason: "No dimensions listed — nothing to check against your doorway.",
    });
  }

  const profile = toKernelProfile(
    body.profile,
    typeof body.flatPack === "boolean" ? body.flatPack : undefined
  );

  try {
    // verbatim: whatever the kernel returns is what the badge, the sprite label
    // and the fit sheet all print
    const fit: FitResult = fits(carton, profile);
    return Response.json(
      { fit, carton, checked: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[api/fit]", err);
    return Response.json({
      fit: null,
      carton,
      checked: false,
      reason: "Couldn't run the fit check on those numbers.",
    });
  }
}
