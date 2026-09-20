"use client";

import * as React from "react";
import NumberFlow, { type Format } from "@number-flow/react";

import { COUNT, cssEase } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Every animated number in the app. The budget, the AR dimension label, the fit
 * sheet and the cart all render through this, so they animate identically.
 *
 * Numbers carry their unit and say where they came from. A null value renders
 * an em dash — an honest dash beats an invented number.
 *
 * EVERY FIGURE IS SOMETYPE MONO, TABULAR. A number that can change must never
 * reflow the words around it, and a serif's old-style figures do exactly that.
 * The mono ships in 400 and 700 only, so figures are set in 400: anything in
 * between would be a synthesised weight.
 *
 * Built on @number-flow/react (MIT). Do not hand-roll a count-up.
 */

export type NumberPlateSize = "xs" | "sm" | "md" | "lg" | "xl";

/** A spring from lib/motion.ts: `COUNT` for money, `SPRING` for the resize. */
export type NumberPlateSpring = {
  stiffness: number;
  damping: number;
  mass?: number;
};

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
  /**
   * Which spring the digits move on. Defaults to `COUNT`, the budget counter;
   * the sprite's millimetre label can pass `SPRING` so it counts on the same
   * spring the resize moves on.
   */
  spring?: NumberPlateSpring;
};

const sizeClass: Record<NumberPlateSize, string> = {
  xs: "text-[13px] leading-none",
  sm: "text-base leading-none",
  md: "text-2xl leading-none",
  lg: "text-4xl leading-none",
  xl: "text-5xl leading-none",
};

const unitClass: Record<NumberPlateSize, string> = {
  xs: "text-[0.85em]",
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

/* ------------------------------------------------------------ the counting */

/**
 * NumberFlow animates with the Web Animations API, which takes a duration and
 * an easing rather than a spring. So the spring from lib/motion.ts is solved
 * here — a unit step, zero starting velocity — and handed over as a `linear()`
 * curve plus the time it takes to settle. The digits then roll exactly the way
 * the budget bar beside them moves, off the same two numbers, instead of on the
 * library's own 900ms default.
 */
function springPosition(spring: NumberPlateSpring, t: number): number {
  const mass = spring.mass ?? 1;
  const w0 = Math.sqrt(spring.stiffness / mass);
  const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * mass));

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * w0 * t) *
        (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    );
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);

  const wd = w0 * Math.sqrt(zeta * zeta - 1);
  return (
    1 -
    Math.exp(-zeta * w0 * t) *
      (Math.cosh(wd * t) + ((zeta * w0) / wd) * Math.sinh(wd * t))
  );
}

type FlowTiming = {
  transform: EffectTiming;
  opacity: EffectTiming;
};

const timingCache = new Map<string, FlowTiming>();

function flowTiming(spring: NumberPlateSpring): FlowTiming {
  const key = `${spring.stiffness}/${spring.damping}/${spring.mass ?? 1}`;
  const cached = timingCache.get(key);
  if (cached) return cached;

  // settled = the last moment it is still more than 0.2% away from the value
  let settle = 0.1;
  for (let t = 0; t <= 3; t += 0.01) {
    if (Math.abs(1 - springPosition(spring, t)) > 0.002) settle = t + 0.01;
  }

  const steps = 28;
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = i === steps ? 1 : springPosition(spring, (settle * i) / steps);
    points.push(String(Math.round(x * 1000) / 1000));
  }

  const duration = Math.round(settle * 1000);
  const timing: FlowTiming = {
    transform: { duration, easing: `linear(${points.join(", ")})` },
    // a digit that is leaving fades over the first half of the roll
    opacity: { duration: Math.round(duration / 2), easing: cssEase("out") },
  };
  timingCache.set(key, timing);
  return timing;
}

/* ---------------------------------------------------------------- the plate */

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
  spring = COUNT,
}: NumberPlateProps) {
  const known = typeof value === "number" && Number.isFinite(value);
  const leading = unit !== undefined && LEADING_UNITS.has(unit);
  const tight = unit !== undefined && TIGHT_UNITS.has(unit);
  const timing = flowTiming(spring);

  const unitNode = unit ? (
    <span
      className={cn(
        // a unit is a label, and labels are mono too
        "font-mono font-normal text-muted-foreground",
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
          "font-mono tabular inline-flex items-baseline font-normal",
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
            transformTiming={timing.transform}
            spinTiming={timing.transform}
            opacityTiming={timing.opacity}
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
