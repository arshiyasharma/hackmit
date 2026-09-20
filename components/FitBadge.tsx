"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Ruler, TriangleAlert, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { NumberPlate } from "@/components/ui/NumberPlate";
import { fits, type FitResult, type Profile as KernelProfile } from "@/lib/fit";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Product, Profile } from "@/types";

/**
 * The compact fit verdict that rides on every ProductCard.
 *
 * THE MATH IS NOT HERE. lib/fit.ts decides; this file only prints what it
 * decided. Every millimetre on screen comes straight out of `fits()` — the
 * badge, the sheet and whatever gets said on stage read the same number.
 *
 * The sheet is loaded with next/dynamic on purpose: FitSheet renders
 * ProductCards for the passing alternatives, and those cards render this
 * badge. Deferring the import keeps that loop out of module evaluation.
 */

const FitSheet = dynamic(() => import("@/components/FitSheet"), { ssr: false });

/* ------------------------------------------------------------- the kernel */

/**
 * types/index.ts spells the measurements out in full; lib/fit.ts uses short
 * names. One translation, in one place, so nothing else has to know.
 */
export function toKernelProfile(profile: Profile): KernelProfile {
  return {
    doorW: profile.doorWidthMm,
    doorH: profile.doorHeightMm,
    hallW: profile.hallwayWidthMm,
    stairW: profile.landingWidthMm,
    ceiling: profile.ceilingHeightMm,
  };
}

/** The verdict for one product, or null when the listing quoted no size. */
export function fitForProduct(
  product: Product,
  profile: Profile
): FitResult | null {
  if (!product.dimsMm) return null;
  return fits(product.dimsMm, toKernelProfile(profile));
}

/** Does this candidate get through the door and round the landing? */
export function productPasses(product: Product, profile: Profile): boolean {
  return fitForProduct(product, profile)?.verdict === "pass";
}

/* ------------------------------------------------------------------ nesting */

/**
 * True inside the fit sheet's "try these instead" list. The alternatives show
 * their verdict but do not open a second sheet on top of the first one.
 */
export const InsideFitSheet = React.createContext(false);

/* -------------------------------------------------------------------- copy */

const mm = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** What went wrong, named by the check that decided it. Never "incompatible". */
export function failHeadline(binding: FitResult["binding"]): string {
  switch (binding) {
    case "door":
      return "Won't fit through your door";
    case "corner":
    case "corner_flat":
      return "Won't turn your landing";
    default:
      return "Won't fit your stairs";
  }
}

export type FitTone = "ok" | "warn" | "accent" | "muted";

export function fitTone(result: FitResult | null): FitTone {
  if (!result) return "muted";
  if (result.verdict === "pass") return "ok";
  if (result.verdict === "tight") return "warn";
  return "accent";
}

const toneClass: Record<FitTone, string> = {
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  accent: "border-accent/40 bg-accent/10 text-accent",
  muted: "border-line bg-muted text-muted-foreground",
};

/** Plain-text version of the badge, for aria-labels and the cart. */
export function fitSummary(result: FitResult | null): string {
  if (!result) return "Can't check — no dimensions listed";
  if (result.marginMm === null) {
    return result.verdict === "pass"
      ? "Fits — flat-packed"
      : failHeadline(result.binding);
  }
  if (result.verdict === "pass") return `Fits — ${mm.format(result.marginMm)} mm to spare`;
  if (result.verdict === "tight") return `Tight — ${mm.format(result.marginMm)} mm to spare`;
  return failHeadline(result.binding);
}

/* ------------------------------------------------------------------- badge */

export type FitBadgeProps = { product: Product };

export function FitBadge({ product }: FitBadgeProps) {
  const profile = useStore((s) => s.profile);
  const nested = React.useContext(InsideFitSheet);
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState(false);

  const result = React.useMemo(
    () => fitForProduct(product, profile),
    [product, profile]
  );

  const tone = fitTone(result);
  const verdict = result?.verdict;

  const icon =
    verdict === "pass" ? (
      <Check className="size-3.5 shrink-0" aria-hidden />
    ) : verdict === "tight" ? (
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
    ) : verdict === "fail" ? (
      <XCircle className="size-3.5 shrink-0" aria-hidden />
    ) : (
      <Ruler className="size-3.5 shrink-0" aria-hidden />
    );

  // the margin animates through NumberPlate; the words around it are static
  const body =
    result && result.marginMm !== null && result.verdict !== "fail" ? (
      <span className="inline-flex items-baseline gap-1">
        <span>{result.verdict === "pass" ? "Fits —" : "Tight —"}</span>
        <NumberPlate
          value={result.marginMm}
          unit="mm"
          size="sm"
          tone={tone === "muted" ? "muted" : tone}
          className="[&>span]:text-[0.8rem]"
          label={`${result.marginMm} millimetres to spare`}
        />
        <span>to spare</span>
      </span>
    ) : (
      <span>{fitSummary(result)}</span>
    );

  const shell = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
    "text-left font-sans text-xs leading-tight",
    toneClass[tone]
  );

  if (nested) {
    return (
      <span className={shell} aria-label={fitSummary(result)}>
        {icon}
        {body}
      </span>
    );
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => {
          // a refusal gets a longer tap than a pass — the hand knows before
          // the eye does that this one is a problem
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(verdict === "fail" ? 20 : 8);
          }
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-label={`${fitSummary(result)}. Open the fit check.`}
        className={cn(shell, "tap cursor-pointer transition-colors")}
        whileTap={reduced ? undefined : { scale: 0.96 }}
        transition={{ type: "spring", stiffness: 520, damping: 30 }}
      >
        {icon}
        {body}
      </motion.button>

      {open ? (
        <FitSheet
          open={open}
          onOpenChange={setOpen}
          product={product}
          result={result}
        />
      ) : null}
    </>
  );
}

export default FitBadge;
