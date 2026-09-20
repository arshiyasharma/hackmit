"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Check, Ruler, TriangleAlert, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { NumberPlate } from "@/components/ui/NumberPlate";
import { fits, type FitResult, type Profile as KernelProfile } from "@/lib/fit";
import { DUR, EASE, cssEase } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { profileToFitProfile } from "@/lib/fitProfile";
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
  return profileToFitProfile(profile);
}

/** The verdict for one product, or null when the listing quoted no size. */
export function fitForProduct(
  product: Product,
  profile: Profile
): FitResult | null {
  if (!product.dimsMm) return null;
  return fits(product.dimsMm, { ...toKernelProfile(profile), dimensionsSource: product.dimsSource });
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
      return "Door clearance risk";
    case "corner":
    case "corner_flat":
      return "Stair-turn clearance risk";
    default:
      return "Headroom clearance risk";
  }
}

/**
 * "accent" stays in the union so nothing that names it stops compiling, but
 * no verdict maps to it any more: see fitTone.
 */
export type FitTone = "ok" | "warn" | "accent" | "muted";

/**
 * A refusal is `warn`. It used to be `accent`, back when the accent was an
 * alarm terracotta; the accent is a calm blue now, and "won't fit your stairs"
 * in the colour of a link reads as an invitation. Tight and fail share the
 * colour and differ by icon and by words, which is what a colour-blind reader
 * was already relying on.
 */
export function fitTone(result: FitResult | null): FitTone {
  if (!result || result.verdict === "unknown") return "muted";
  if (result.verdict === "pass") return "ok";
  return "warn";
}

/* tinted paper, not glass: the badge rides on cards that may already be glass
   inside a glass tray, and a third pane is one too many */
const toneClass: Record<FitTone, string> = {
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  accent: "border-accent/40 bg-accent/10 text-accent",
  muted: "border-line bg-muted text-muted-foreground",
};

/** Only the button hovers; the nested, non-interactive badge must not pretend. */
const hoverClass: Record<FitTone, string> = {
  ok: "hover:border-ok/60 hover:bg-ok/15",
  warn: "hover:border-warn/65 hover:bg-warn/15",
  accent: "hover:border-accent/65 hover:bg-accent/15",
  muted: "hover:border-foreground/25 hover:text-foreground",
};

/** Plain-text version of the badge, for aria-labels and the cart. */
export function fitSummary(result: FitResult | null): string {
  if (!result) return "Product dimensions needed";
  if (result.verdict === "unknown") return result.binding === "flat_pack" ? "Packed dimensions needed" : "Measurements needed";
  const prefix = result.confidence === "estimated" ? "Estimated · " : "";
  if (result.verdict === "fail") return prefix + failHeadline(result.binding);
  if (result.marginMm === null) return prefix + "Tilt needed · verify route";
  return `${prefix}${result.verdict === "pass" ? "Model clearance" : "Tight"} · ${mm.format(result.marginMm)} mm`;
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

  /*
   * The margin animates through NumberPlate; the words around it are static.
   * The unit is written here rather than handed to NumberPlate, which sets a
   * unit smaller than its number — in a 12px chip that is a 10px "mm".
   */
  const body =
    result && result.marginMm !== null && result.verdict !== "fail" ? (
      <span className="inline-flex items-baseline gap-[0.5ch] whitespace-nowrap">
        <span>{result.confidence === "estimated" ? "Estimated · " : ""}{result.verdict === "pass" ? "Clearance —" : "Tight —"}</span>
        <NumberPlate
          value={result.marginMm}
          size="xs"
          tone={tone}
          // the chip's own size, so the figure sits on the same line as its words
          className="[&>span]:text-[12px]"
          label={`${result.marginMm} millimetres to spare`}
        />
        <span>mm to spare</span>
      </span>
    ) : (
      <span>{fitSummary(result)}</span>
    );

  const shell = cn(
    "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
    "tabular text-left font-mono text-[12px] leading-tight",
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
        // `tap` keeps a 44px hit area around a chip that is drawn at 28px
        className={cn(
          shell,
          hoverClass[tone],
          "tap cursor-pointer transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        )}
        style={{
          transitionDuration: `${DUR.micro}s`,
          transitionTimingFunction: cssEase("out"),
        }}
        whileTap={reduced ? undefined : { scale: 0.96 }}
        transition={{ duration: DUR.micro, ease: EASE.out }}
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
