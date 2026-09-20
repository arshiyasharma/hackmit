/**
 * THE MOTION SYSTEM — one file, as the motion sheet asks
 * (docs/ROOM3_PRODUCT_SPEC.md). If a number is not in this table it does not
 * belong in a component.
 *
 * Eases are cubic-bezier control points, the shape `motion` and the Web
 * Animations API both take. Durations are seconds. Springs are
 * stiffness / damping / mass.
 */

export const EASE = {
  /** every entrance */
  out: [0.16, 1, 0.3, 1],
  /** two-way changes, the cover over the landing */
  inOut: [0.65, 0, 0.35, 1],
  /** exits */
  in: [0.7, 0, 0.84, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const DUR = {
  /** chips, hovers, the caret */
  micro: 0.24,
  /** one element arriving */
  element: 0.6,
  /** a whole screen changing */
  scene: 1.2,
} as const;

/** THE RESIZE, AND NOTHING ELSE. Settles in ~400ms with one overshoot. */
export const SPRING = { type: "spring", stiffness: 220, damping: 26, mass: 1 } as const;

/** The budget counter: slower, so the digits stay readable while they move. */
export const COUNT = { type: "spring", stiffness: 140, damping: 24 } as const;

/** Anything linked to a drag or a scroll: the listing rail has weight. */
export const SCRUB = { type: "spring", stiffness: 120, damping: 30 } as const;

export const STAGGER = {
  /** headline lines */
  line: 0.08,
  /** list items, chips, bubbles */
  chip: 0.04,
} as const;

/** The same curves for CSS: `transition-timing-function: ${cssEase("out")}`. */
export function cssEase(name: keyof typeof EASE): string {
  return `cubic-bezier(${EASE[name].join(", ")})`;
}

/** One element arriving. Spread into a `motion` transition. */
export const ENTER = { duration: DUR.element, ease: EASE.out } as const;
/** One element leaving. */
export const EXIT = { duration: DUR.micro, ease: EASE.in } as const;
/** What reduced motion gets instead of all of the above: a quick fade. */
export const REDUCED = { duration: 0.15, ease: "linear" } as const;
