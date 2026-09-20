"use client";

import * as React from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { cn } from "@/lib/utils";

/**
 * Every animated number in the app. The rail, the AR dimension label, the fit
 * sheet and the cart all render through this, so they animate identically.
 *
 * Numbers carry their unit and say where they came from. A null value renders
 * an em dash — an honest dash beats an invented number.
 *
 * Built on @number-flow/react (MIT). Do not hand-roll a count-up.
 */

export type NumberPlateSize = "sm" | "md" | "lg" | "xl";

export type NumberPlateProps = {
  /** null means "we do not know this yet"; renders as — */
  value: number | null | undefined;
  /** "mm", "%", "minutes", "$" … rendered inline with the number */
  unit?: string;
  /** small muted caption underneath: "IKEA listing", "you measured this" */
  source?: string;
  size?: NumberPlateSize;

  /* optional, additive */
  format?: Format;
  locales?: Intl.LocalesArgument;
  className?: string;
  /** colour the number, e.g. a warn-coloured over-budget total */
  tone?: "default" | "accent" | "ok" | "warn" | "muted";
  /** accessible label when the number alone does not say what it counts */
  label?: string;
};

const sizeClass: Record<NumberPlateSize, string> = {
  sm: "text-base leading-none",
  md: "text-2xl leading-none",
  lg: "text-4xl leading-none",
  xl: "text-5xl leading-none",
};

const unitClass: Record<NumberPlateSize, string> = {
  sm: "text-[0.7em]",
  md: "text-[0.55em]",
  lg: "text-[0.45em]",
  xl: "text-[0.4em]",
};

const toneClass = {
  default: "text-foreground",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  muted: "text-muted-foreground",
} as const;

/** Currency marks sit in front of the number; everything else follows it. */
const LEADING_UNITS = new Set(["$", "£", "€", "¥", "₹"]);

/** Units that sit tight against the number, with no space. */
const TIGHT_UNITS = new Set(["%", "°", "$", "£", "€", "¥", "₹"]);

export function NumberPlate({
  value,
  unit,
  source,
  size = "md",
  format,
  locales,
  className,
  tone = "default",
  label,
}: NumberPlateProps) {
  const known = typeof value === "number" && Number.isFinite(value);
  const leading = unit !== undefined && LEADING_UNITS.has(unit);
  const tight = unit !== undefined && TIGHT_UNITS.has(unit);

  const unitNode = unit ? (
    <span
      className={cn(
        "font-sans font-medium text-muted-foreground",
        unitClass[size],
        leading ? (tight ? "mr-0" : "mr-1") : tight ? "ml-0" : "ml-1"
      )}
    >
      {unit}
    </span>
  ) : null;

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <span
        className={cn(
          "font-display tabular inline-flex items-baseline font-semibold",
          sizeClass[size],
          toneClass[tone]
        )}
        aria-label={label}
      >
        {leading ? unitNode : null}
        {known ? (
          <NumberFlow
            value={value as number}
            format={format}
            locales={locales}
            // the whole point of number-flow: no jitter, no layout shift
            willChange
          />
        ) : (
          <span aria-label="not known yet">—</span>
        )}
        {!leading ? unitNode : null}
      </span>

      {source ? (
        <span className="font-sans text-xs text-muted-foreground">{source}</span>
      ) : null}
    </span>
  );
}

export default NumberPlate;

/* ------------------------------------------------------------- formatters */

/** Money is integer cents everywhere. This is the only place it becomes a float. */
export function centsToUnits(cents: number): number {
  return cents / 100;
}

/** "1,900 x 720 x 640 mm" — the dimension string used on every product. */
export function formatCarton(
  dims: readonly [number, number, number] | undefined,
  locales: string = "en-US"
): string | null {
  if (!dims) return null;
  const n = new Intl.NumberFormat(locales, { maximumFractionDigits: 0 });
  return `${n.format(dims[0])} × ${n.format(dims[1])} × ${n.format(dims[2])} mm`;
}
