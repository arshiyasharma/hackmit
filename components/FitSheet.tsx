"use client";

import * as React from "react";
import { Check, RotateCcw, Ruler, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion, type Transition } from "motion/react";

import { InsideFitSheet, failHeadline, fitTone, productPasses } from "@/components/FitBadge";
import ProductCard from "@/components/ProductCard";
import { Blueprint, ProfileSheet } from "@/components/ProfileSheet";
import { Sheet } from "@/components/ui/Sheet";
import { NumberPlate, formatCarton } from "@/components/ui/NumberPlate";
import { planarCornerLimit, cornerTilt, type FitResult } from "@/lib/fit";
import { DUR, EASE, ENTER, REDUCED, STAGGER, cssEase } from "@/lib/motion";
import { itemById, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * The fit check, explained — beat 07, "nobody measures the stairwell".
 *
 * One beat of pure engineering, in a different register from everything around
 * it, is what makes the rest credible. So this is a BLUEPRINT: a sheet of
 * drafting paper on the left with a 1px line drawing, a schedule of mono
 * figures on the right, and nothing decorative in between.
 *
 * Every number printed here comes out of lib/fit.ts. The decisive sentence is
 * the kernel's own `reason`, word for word — it is the sentence said out loud
 * on stage, so it is not reworded, re-rounded or softened here. Figures the
 * kernel never reached are not shown: a box that stopped at the door has no
 * tilt angle, so none is drawn.
 *
 * The drawing derives its angles from the kernel's exported
 * planarCornerLimit(), so the picture and the verdict cannot disagree.
 */

export type FitSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  /** null when the listing quoted no dimensions */
  result: FitResult | null;
};

const mm = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * One frozen empty array, reused. The store selector below must return a
 * stable reference when there are no options, or useSyncExternalStore sees a
 * new snapshot on every render and loops forever.
 */
const NO_OPTIONS: readonly Product[] = Object.freeze([]);

/** Hovers and chips: the motion table's `micro`, for CSS transitions. */
const MICRO: React.CSSProperties = {
  transitionDuration: `${DUR.micro}s`,
  transitionTimingFunction: cssEase("out"),
};

/* no `outline-none` beside it — in Tailwind 4 that switches `outline-2` off too */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** A figure inside a sentence: same words, the digits in the number face. */
function N({ children }: { children: React.ReactNode }) {
  return <span className="tabular font-mono text-[0.92em]">{children}</span>;
}

/**
 * A sentence with its digits set in mono. The characters and their order are
 * untouched — split, wrap, print — so the kernel's `reason` is still verbatim
 * to a reader, a screen reader and a find-in-page.
 *
 * `display` is for a sentence set in Cormorant, whose figures sit much smaller
 * on the line than Sometype's: the mono has to come down further to match.
 */
function Verbatim({ text, display = false }: { text: string; display?: boolean }) {
  const parts = text.split(/(\d+(?:[.,]\d+)*)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className={cn("tabular font-mono", display ? "text-[0.78em]" : "text-[0.92em]")}
          >
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

export function FitSheet({ open, onOpenChange, product, result }: FitSheetProps) {
  const profile = useStore((s) => s.profile);
  /*
   * The alternatives come from THIS item's option set — the five listings the
   * search returned for the thing standing in the room. v2 kept a flat
   * `products` array on the store; v3 hangs options off the PlacedItem, so we
   * find the item that owns this listing and fall back to the active one.
   */
  const products = useStore((s) => {
    const owner =
      s.items.find((item) => item.options.some((p) => p.id === product.id)) ??
      itemById(s.items, s.activeItemId);
    return owner?.options ?? NO_OPTIONS;
  });
  const [profileOpen, setProfileOpen] = React.useState(false);
  const reduced = useReducedMotion() ?? false;
  /** bumped by "Replay": remounts the moving parts so they run from the start */
  const [run, setRun] = React.useState(0);

  const geometry = React.useMemo(() => {
    if (!product.dimsMm) return null;
    const [l, m, s] = [...product.dimsMm].sort((a, b) => b - a);
    const { limit, atDeg } = planarCornerLimit(
      profile.hallwayWidthMm,
      profile.landingWidthMm,
      s
    );
    const tilt = limit !== null ? cornerTilt(l, m, limit) : null;
    const phi = tilt?.phi ?? 0;
    return {
      l,
      m,
      s,
      limit,
      atDeg,
      phi,
      headroom: tilt?.finalHeight ?? m,
    };
  }, [product.dimsMm, profile.hallwayWidthMm, profile.landingWidthMm]);

  const alternatives = React.useMemo(() => {
    if (!result || result.verdict !== "fail") return [];
    // `products` is already this one item's option set, so no second grouping.
    const pool = products.filter(
      (p) => p.id !== product.id && productPasses(p, profile)
    );
    return [...pool].sort((a, b) => a.priceCents - b.priceCents).slice(0, 2);
  }, [products, product.id, profile, result]);

  const tone = fitTone(result);
  const headline = !result
    ? "Can't check this one"
    : result.verdict === "unknown"
      ? "Measurements needed"
      : result.verdict === "pass"
        ? "Clear in this model"
        : result.verdict === "tight"
          ? "Tight clearance"
          : failHeadline(result.binding);

  const binding = result?.binding ?? null;
  /* the kernel only works out a lean once the door and the flat turn are behind it */
  const leaned = binding === "corner_tilted" || binding === "headroom";
  const tiltDeg = leaned && geometry ? (geometry.phi * 180) / Math.PI : 0;
  /* the edge that stopped it, or nearly did, is drawn in warn */
  const alarm = result !== null && result.verdict !== "pass";

  const drawn = Boolean(result && result.verdict !== "unknown" && geometry && binding !== "flat_pack");
  /* the sentence lands when the drawing has finished saying it */
  const settle = reduced ? 0 : drawn ? DUR.scene : DUR.element;

  /** one element of the right-hand column arriving, in reading order */
  const rise: Rise = (order) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: REDUCED }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { ...ENTER, delay: DUR.micro + order * STAGGER.chip },
        };

  /*
   * What the kernel's margin is a margin OF depends on the check that set it:
   * at the door it is the opening's narrow side against the box's thinnest
   * side, everywhere else it is room at the landing.
   */
  const marginSource =
    !result || result.marginMm === null
      ? undefined
      : result.binding === "door"
        ? result.marginMm < 0
          ? "short of your door"
          : "to spare on its thinnest side"
        : result.marginMm < 0
          ? "short of your landing"
          : "clearance at the tightest point";

  return (
    <>
      <Sheet
        /*
         * One dialog at a time. While the measurements are open this one steps
         * aside instead of sitting underneath: two modal dialogs would fight
         * over focus and Escape would close both. It comes back when the
         * measurements close — with the new numbers, and the drawing re-run.
         */
        open={open && !profileOpen}
        onOpenChange={onOpenChange}
        snapPoints={[0.9]}
        initialSnap={0}
        label="Fit check"
        // the drawing and the schedule sit side by side; that needs the width
        className="desk:max-w-[60rem]"
      >
        <div className="flex flex-col gap-8">
          <div className="grid gap-x-10 gap-y-6 desk:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)] desk:grid-rows-[auto_1fr]">
            {/* the dialog draws its own close button, in the corner above this */}
            <header className="flex flex-col desk:col-start-2 desk:row-start-1">
              <p className="eyebrow text-muted-foreground">Fit check</p>

              {/* the headline arrives as a line: clipped here, the child rises */}
              <h2
                className={cn(
                  "mt-4 overflow-hidden pb-[0.14em] pt-[0.06em] font-display text-[2.75rem] font-normal leading-none tracking-[0.01em] desk:text-[3.5rem]",
                  tone === "ok" && "text-ok",
                  tone === "warn" && "text-warn"
                )}
              >
                <motion.span
                  className="block"
                  initial={reduced ? { opacity: 0 } : { y: "110%" }}
                  animate={reduced ? { opacity: 1 } : { y: 0 }}
                  transition={reduced ? REDUCED : ENTER}
                >
                  {headline}
                </motion.span>
              </h2>
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{product.title}</p>
            </header>

            {/* ------------------------------------------------ the drawing */}
            <Blueprint className="self-start p-4 desk:sticky desk:top-2 desk:col-start-1 desk:row-span-2 desk:row-start-1 desk:p-5">
              {!result || !geometry ? (
                <NoDrawing label="No size on the listing" />
              ) : result.verdict === "unknown" ? (
                <NoDrawing label={binding === "flat_pack" ? "Packed dimensions needed" : "Add delivery measurements"} />
              ) : (
                <div className="flex flex-col gap-4">
                  {binding === "door" ? (
                    <DoorSection
                      key={`door-${run}`}
                      faceWMm={geometry.s}
                      faceHMm={geometry.m}
                      doorWMm={profile.doorWidthMm}
                      doorHMm={profile.doorHeightMm}
                      reduced={reduced}
                      onReplay={() => setRun((n) => n + 1)}
                    />
                  ) : (
                    <PlanView
                      key={`plan-${run}`}
                      hallMm={profile.hallwayWidthMm}
                      landingMm={profile.landingWidthMm}
                      lengthMm={geometry.l}
                      verticalMm={geometry.m}
                      depthMm={geometry.s}
                      turnDeg={geometry.atDeg ?? 45}
                      tiltDeg={tiltDeg}
                      blocked={binding === "corner"}
                      reduced={reduced}
                      onReplay={() => setRun((n) => n + 1)}
                    />
                  )}

                  {leaned ? (
                    <div className="border-t border-accent-pale pt-4">
                      <Elevation
                        key={`section-${run}`}
                        lengthMm={geometry.l}
                        midMm={geometry.m}
                        tiltDeg={tiltDeg}
                        headroomMm={geometry.headroom}
                        ceilingMm={profile.ceilingHeightMm}
                        alarm={alarm}
                        reduced={reduced}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </Blueprint>

            {/* ----------------------------------------------- the figures */}
            <div className="flex min-w-0 flex-col gap-6 desk:col-start-2 desk:row-start-2">
              {/* the kernel's own sentence, verbatim; it arrives last */}
              <motion.p
                className="max-w-[34ch] font-display text-[1.5rem] font-medium leading-[1.18] tracking-[0.01em]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduced ? REDUCED : { ...ENTER, delay: settle }}
              >
                <Verbatim
                  display
                  text={
                    result
                      ? result.reason
                      : "This listing does not publish its packed size, so there is nothing to measure against your doorways."
                  }
                />
              </motion.p>

              {result && result.marginMm !== null ? (
                <motion.div {...rise(0)}>
                  <NumberPlate
                    value={result.marginMm}
                    unit="mm"
                    size="lg"
                    tone={tone}
                    source={marginSource}
                  />
                </motion.div>
              ) : null}

              <Checks result={result} rise={rise} />

              <motion.p
                {...rise(5)}
                className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground"
              >
                Optional route measurements are marked as measured or unknown. This
                check models a rectangular box, a clear doorway, and one level 90°
                turn. It does not model stair slopes, winding stairs, corridor length,
                handrails, people carrying the item, or a complete 3D path. Verify
                packed dimensions and all obstructions with the delivery team.
              </motion.p>

              <motion.div {...rise(6)}>
                <button
                  type="button"
                  onClick={() => setProfileOpen(true)}
                  aria-haspopup="dialog"
                  style={MICRO}
                  className={cn(
                    "glass-pill inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 px-5",
                    "text-sm font-medium transition-transform hover:-translate-y-px active:translate-y-0 desk:w-auto",
                    FOCUS_RING
                  )}
                >
                  <Ruler className="size-4 text-accent" aria-hidden />
                  Add or edit measurements
                </button>
              </motion.div>
            </div>
          </div>

          {result?.verdict === "fail" ? (
            <section className="flex flex-col gap-4 border-t border-line pt-6">
              <h3 className="font-display text-[1.75rem] font-medium leading-none tracking-[0.01em]">
                Try these instead
              </h3>
              {alternatives.length > 0 ? (
                <InsideFitSheet.Provider value>
                  <div className="grid gap-3 desk:grid-cols-2">
                    {alternatives.map((p) => (
                      <ProductCard key={p.id} product={p} compact />
                    ))}
                  </div>
                </InsideFitSheet.Provider>
              ) : (
                <div className="max-w-[68ch] rounded-[22px] border border-line bg-surface/70 p-4 text-sm leading-relaxed">
                  <p>
                    Nothing sourced for this spot clears your landing yet. Two things
                    move that number: a smaller box, or a measurement you take instead
                    of one we assumed.
                  </p>
                  <a
                    href={`https://www.google.com/search?tbm=shop&q=${encodeURIComponent(
                      `${product.title} compact`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "mt-1 inline-flex h-11 items-center rounded text-sm font-medium text-accent",
                      "underline underline-offset-4 hover:decoration-2",
                      FOCUS_RING
                    )}
                  >
                    Search a smaller one
                  </a>
                </div>
              )}
            </section>
          ) : null}

          <p className="tabular font-mono text-[11px] leading-relaxed text-muted-foreground">
            {formatCarton(product.dimsMm) ?? "No size on the listing"}
            {product.dimsMm
              ? product.dimsSource === "quoted"
                ? ` — from the ${product.retailer} listing`
                : product.dimsSource === "approx"
                  ? " — approx, a typical size for this kind of thing"
                  : " — estimated"
              : ""}
          </p>
        </div>
      </Sheet>

      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

/* ------------------------------------------------------------ the diagram */

/*
 * All three drawings share one width in user units, draw in millimetres scaled
 * once, and are stroke only: 1px lines that stay 1px however wide the dialog
 * is (`vector-effect: non-scaling-stroke`). Accent is the pen; warn is the one
 * edge that stopped the box; ink is for figures.
 *
 * They play ONCE, over `DUR.scene`, and rest on the pose the kernel decided.
 * A drawing that loops next to a table you are trying to read is a distraction
 * — "Replay" is there for the second look.
 */
const W = 360;

const LINE = {
  fill: "none",
  strokeWidth: 1,
  vectorEffect: "non-scaling-stroke",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PEN = "var(--accent)";
const ALARM = "var(--warn)";
const FIGURE = "tabular fill-foreground font-mono text-[10.5px]";

/** motion moves SVG groups about their own box unless told the origin is the drawing's */
const ABOUT_ORIGIN = { transformBox: "view-box", transformOrigin: "0px 0px" } as const;

/** The box: an outline and its diagonals — the drafting mark for "a crate". */
function Carton({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} {...LINE} strokeWidth={1.5} stroke={PEN} />
      <path
        d={`M ${x} ${y} L ${x + w} ${y + h} M ${x + w} ${y} L ${x} ${y + h}`}
        {...LINE}
        stroke={PEN}
        strokeOpacity={0.35}
      />
    </>
  );
}

/** A dimension line with its two end ticks. Horizontal or vertical only. */
function Dimension({
  x1,
  y1,
  x2,
  y2,
  stroke = PEN,
  dashed = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: string;
  dashed?: boolean;
}) {
  const t = 4;
  const ticks =
    y1 === y2
      ? `M ${x1} ${y1 - t} V ${y1 + t} M ${x2} ${y2 - t} V ${y2 + t}`
      : `M ${x1 - t} ${y1} H ${x1 + t} M ${x2 - t} ${y2} H ${x2 + t}`;
  return (
    <>
      <path
        d={`M ${x1} ${y1} L ${x2} ${y2}`}
        {...LINE}
        stroke={stroke}
        strokeOpacity={0.75}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <path d={ticks} {...LINE} stroke={stroke} strokeOpacity={0.75} />
    </>
  );
}

function DrawingHead({ name, onReplay }: { name: string; onReplay?: () => void }) {
  return (
    <div className="mb-1 flex h-7 items-center justify-between gap-3">
      <p className="eyebrow text-muted-foreground">{name}</p>
      {onReplay ? (
        <button
          type="button"
          onClick={onReplay}
          style={MICRO}
          className={cn(
            "tap inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5",
            "font-mono text-[11px] text-accent transition-colors hover:bg-accent/10",
            FOCUS_RING
          )}
        >
          <RotateCcw className="size-3" aria-hidden />
          Replay
        </button>
      ) : null}
    </div>
  );
}

function NoDrawing({ label }: { label: string }) {
  return (
    <div className="grid min-h-44 place-items-center p-6 text-center">
      <p className="eyebrow text-muted-foreground">{label}</p>
    </div>
  );
}

type PlanProps = {
  hallMm: number;
  landingMm: number;
  lengthMm: number;
  verticalMm: number;
  depthMm: number;
  turnDeg: number;
  tiltDeg: number;
  /** nothing this thick turns the corner: the box stops short and the corner is the alarm */
  blocked: boolean;
  reduced: boolean;
  onReplay: () => void;
};

/**
 * Plan view: the hallway meeting the landing at a right angle, with the box
 * drawn at its real proportions, turning the corner and then tilting up (which
 * from above reads as the footprint shortening to length × cos(tilt)).
 */
function PlanView({
  hallMm,
  landingMm,
  lengthMm,
  verticalMm,
  depthMm,
  turnDeg,
  tiltDeg,
  blocked,
  reduced,
  onReplay,
}: PlanProps) {
  const H = 216;
  const pad = 22;
  // everything is drawn in millimetres, then scaled once. The hallway runs up
  // the page (its WIDTH is horizontal), the landing runs right.
  const spanX = hallMm + Math.max(lengthMm, landingMm) * 1.1;
  const spanY = landingMm + Math.max(lengthMm, hallMm) * 1.1;
  const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const hall = hallMm * k;
  const landing = landingMm * k;
  const len = lengthMm * k;
  const depth = depthMm * k;

  const tilt = (tiltDeg * Math.PI) / 180;
  const foreshortened = Math.cos(tilt) + (verticalMm / lengthMm) * Math.sin(tilt);
  const turn = 90 - turnDeg;

  const hallX = pad + hall / 2;
  const start = { x: hallX, y: H - pad - len / 2 };
  /* fully inside the hallway, nose under the landing */
  const below = { x: hallX, y: pad + landing + len * 0.6 };
  const rest = {
    // never drawn through the outer wall, however long it is
    x: pad + Math.max(hall + len * 0.35, len / 2 + 2),
    y: pad + landing / 2,
  };

  const pose = blocked
    ? { x: below.x, y: below.y, rotate: 90, scaleX: 1 }
    : { x: rest.x, y: rest.y, rotate: 0, scaleX: foreshortened };

  const travel = blocked
    ? { x: [start.x, below.x], y: [start.y, below.y], rotate: [90, 90], scaleX: [1, 1] }
    : {
        x: [start.x, below.x, pad + hall * 0.7, rest.x, rest.x],
        y: [start.y, below.y, pad + landing * 0.9, rest.y, rest.y],
        rotate: [90, 90, turn, 0, 0],
        scaleX: [1, 1, 1, 1, foreshortened],
      };

  return (
    <figure className="flex flex-col">
      <DrawingHead name="Plan" onReplay={reduced ? undefined : onReplay} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Plan view of the box turning from your hallway onto the landing, then tilting up."
      >
        {/* the corridor walls: outer corner top-left, inner corner offset by both widths */}
        <path
          d={`M ${W - pad} ${pad} L ${pad} ${pad} L ${pad} ${H - pad}`}
          {...LINE}
          stroke={PEN}
        />
        <path
          d={`M ${W - pad} ${pad + landing} L ${pad + hall} ${pad + landing} L ${pad + hall} ${H - pad}`}
          {...LINE}
          strokeWidth={blocked ? 1.5 : 1}
          stroke={blocked ? ALARM : PEN}
        />

        <Dimension x1={pad} y1={H - pad + 8} x2={pad + hall} y2={H - pad + 8} />
        <text x={pad + hall + 8} y={H - pad + 11} className={FIGURE}>
          hallway {mm.format(hallMm)} mm
        </text>
        <Dimension x1={W - pad + 8} y1={pad} x2={W - pad + 8} y2={pad + landing} />
        <text x={W - pad - 4} y={pad + landing + 14} textAnchor="end" className={FIGURE}>
          landing {mm.format(landingMm)} mm
        </text>

        <motion.g
          style={ABOUT_ORIGIN}
          initial={reduced ? false : { x: start.x, y: start.y, rotate: 90, scaleX: 1 }}
          animate={reduced ? pose : travel}
          transition={
            reduced
              ? REDUCED
              : blocked
                ? { duration: DUR.scene, ease: EASE.inOut }
                : { duration: DUR.scene, times: [0, 0.3, 0.55, 0.8, 1], ease: EASE.inOut }
          }
        >
          <Carton x={-len / 2} y={-depth / 2} w={len} h={depth} />
        </motion.g>
      </svg>
      <figcaption className="mt-1 text-[12px] leading-snug text-muted-foreground">
        <N>{mm.format(lengthMm)}</N> mm long, <N>{mm.format(depthMm)}</N> mm thick, drawn to
        scale against your corridor.
      </figcaption>
    </figure>
  );
}

/**
 * Side view: how far it has to lean, and what that costs in headroom.
 *
 * The box pivots on the corner that stays on the floor, so its highest point
 * is exactly the kernel's headroom (l·sin + m·cos) above the floor line, and
 * the "needs" dimension is measured to that point — on a fail you can see it
 * go through the ceiling.
 */
function Elevation({
  lengthMm,
  midMm,
  tiltDeg,
  headroomMm,
  ceilingMm,
  alarm,
  reduced,
}: {
  lengthMm: number;
  midMm: number;
  tiltDeg: number;
  headroomMm: number;
  ceilingMm: number;
  alarm: boolean;
  reduced: boolean;
}) {
  const H = 176;
  const pad = 22;
  /* room kept clear on the right for "needs N mm" */
  const reserve = 118;
  const theta = (tiltDeg * Math.PI) / 180;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);

  const k = Math.min(
    (H - pad * 2) / Math.max(ceilingMm, headroomMm * 1.05),
    (W - pad * 2 - reserve) / (lengthMm + midMm * sin)
  );
  const floorY = H - pad;
  const ceilingY = floorY - ceilingMm * k;
  const len = lengthMm * k;
  const thick = midMm * k;

  /* the pivot, set in far enough that the leaning back corner stays on the sheet */
  const x0 = pad + thick * sin + 2;
  const topX = x0 + len * cos - thick * sin;
  const topY = floorY - headroomMm * k;
  const dimX = x0 + len * cos + 14;
  const arc = Math.min(34, len * 0.4);

  const edge = alarm ? ALARM : PEN;

  return (
    <figure className="flex flex-col">
      <DrawingHead name="Section" />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Side view: leaning ${tiltDeg.toFixed(1)} degrees needs ${mm.format(
          Math.round(headroomMm)
        )} millimetres of headroom under your ${mm.format(ceilingMm)} millimetre ceiling.`}
      >
        <path d={`M ${pad} ${floorY} H ${W - pad}`} {...LINE} stroke={PEN} />
        {/* the ceiling is the edge this check is about */}
        <path
          d={`M ${pad} ${ceilingY} H ${W - pad}`}
          {...LINE}
          strokeWidth={alarm ? 1.5 : 1}
          stroke={edge}
        />
        <text x={W - pad - 2} y={ceilingY - 5} textAnchor="end" className={FIGURE}>
          ceiling {mm.format(ceilingMm)} mm
        </text>

        <motion.g
          style={ABOUT_ORIGIN}
          initial={reduced ? false : { x: x0, y: floorY, rotate: 0 }}
          animate={{ x: x0, y: floorY, rotate: -tiltDeg }}
          transition={reduced ? REDUCED : { duration: DUR.scene, ease: EASE.inOut }}
        >
          <Carton x={0} y={-thick} w={len} h={thick} />
        </motion.g>

        {/* what the lean costs, measured once the box has finished leaning */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduced ? REDUCED : { ...ENTER, delay: DUR.scene }}
        >
          <path
            d={`M ${x0 + arc} ${floorY} A ${arc} ${arc} 0 0 0 ${x0 + arc * cos} ${floorY - arc * sin}`}
            {...LINE}
            stroke={PEN}
            strokeOpacity={0.75}
          />
          <text x={x0 + arc + 5} y={floorY + 14} className={FIGURE}>
            {tiltDeg.toFixed(1)}°
          </text>

          <path
            d={`M ${topX} ${topY} H ${dimX + 4}`}
            {...LINE}
            stroke={edge}
            strokeOpacity={0.5}
            strokeDasharray="2 3"
          />
          <Dimension x1={dimX} y1={floorY} x2={dimX} y2={topY} stroke={edge} dashed />
          <text
            x={dimX + 8}
            y={(floorY + topY) / 2 + 4}
            className={cn(FIGURE, alarm && "fill-warn")}
          >
            needs {mm.format(Math.round(headroomMm))} mm
          </text>
        </motion.g>
      </svg>
      <figcaption className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Final orientation at <N>{tiltDeg.toFixed(1)}</N>°. The check also reserves the
        maximum headroom swept while tilting; the full carry path needs verification.
      </figcaption>
    </figure>
  );
}

/**
 * The check that stopped it, when that check was the door: the box's smallest
 * face against the opening, both to scale, standing on the same floor line.
 * The kernel tried both rotations; this draws the upright one and marks
 * whichever side of the frame the face runs into.
 */
function DoorSection({
  faceWMm,
  faceHMm,
  doorWMm,
  doorHMm,
  reduced,
  onReplay,
}: {
  faceWMm: number;
  faceHMm: number;
  doorWMm: number;
  doorHMm: number;
  reduced: boolean;
  onReplay: () => void;
}) {
  const H = 216;
  const pad = 22;
  /* room kept clear on the right for the two figures */
  const reserve = 150;
  const k = Math.min(
    (H - pad * 2) / (Math.max(doorHMm, faceHMm) * 1.05),
    (W - pad * 2 - reserve) / (Math.max(doorWMm, faceWMm) * 1.2)
  );
  const floorY = H - pad;
  const doorW = doorWMm * k;
  const doorH = doorHMm * k;
  const faceW = faceWMm * k;
  const faceH = faceHMm * k;
  const cx = pad + (W - pad * 2 - reserve) / 2;
  const left = cx - doorW / 2;
  const right = cx + doorW / 2;
  const top = floorY - doorH;

  const tooWide = faceWMm > doorWMm;
  const tooTall = faceHMm > doorHMm;
  const labelX = Math.max(right, cx + faceW / 2) + 16;

  return (
    <figure className="flex flex-col">
      <DrawingHead name="Door" onReplay={reduced ? undefined : onReplay} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`The box's ${mm.format(faceWMm)} by ${mm.format(
          faceHMm
        )} millimetre face against your ${mm.format(doorWMm)} by ${mm.format(
          doorHMm
        )} millimetre door opening.`}
      >
        <path d={`M ${pad} ${floorY} H ${W - pad}`} {...LINE} stroke={PEN} />

        {/* the frame, a side at a time, so the side it hits can be the alarm */}
        <path
          d={`M ${left} ${floorY} V ${top} M ${right} ${floorY} V ${top}`}
          {...LINE}
          strokeWidth={tooWide ? 1.5 : 1}
          stroke={tooWide ? ALARM : PEN}
        />
        <path
          d={`M ${left} ${top} H ${right}`}
          {...LINE}
          strokeWidth={tooTall ? 1.5 : 1}
          stroke={tooTall ? ALARM : PEN}
        />

        <motion.g
          style={ABOUT_ORIGIN}
          initial={reduced ? false : { x: cx - faceW * 0.9 - 12, y: floorY }}
          animate={{ x: cx, y: floorY }}
          transition={reduced ? REDUCED : { duration: DUR.scene, ease: EASE.inOut }}
        >
          <Carton x={-faceW / 2} y={-faceH} w={faceW} h={faceH} />
        </motion.g>

        <text x={labelX} y={top + 12} className={FIGURE}>
          door {mm.format(doorWMm)} × {mm.format(doorHMm)} mm
        </text>
        <text x={labelX} y={top + 28} className={cn(FIGURE, "fill-warn")}>
          face {mm.format(faceWMm)} × {mm.format(faceHMm)} mm
        </text>
      </svg>
      <figcaption className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Its smallest face, <N>{mm.format(faceWMm)}</N> × <N>{mm.format(faceHMm)}</N> mm, drawn
        to scale against your door.
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------- the checks */

type Rise = (order: number) => {
  initial: { opacity: number; y?: number };
  animate: { opacity: number; y?: number };
  transition: Transition;
};

function Checks({ result, rise }: { result: FitResult | null; rise: Rise }) {
  if (!result?.checks) return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      Add product dimensions and optional route measurements to check the door,
      the stair turn and the headroom separately.
    </p>
  );
  const names = { door: "Doorway", corner: "90° stair turn", headroom: "Landing headroom" };
  const states = { pass: "Clear in model", tight: "Tight / verify", fail: "Clearance risk", unknown: "Not checked" };
  return (
    <ul className="divide-y divide-line border-y border-line">
      {result.checks.map((check, index) => (
        <motion.li key={check.key} {...rise(index + 1)} className="py-3">
          <div className="flex items-center justify-between gap-3 text-sm font-medium">
            <span>{names[check.key]}</span>
            <span className={cn("inline-flex items-center gap-1.5 text-[11px]", check.verdict === "unknown" ? "text-muted-foreground" : check.verdict === "pass" ? "text-ok" : "text-warn")}>
              {check.verdict === "pass" ? <Check size={13} aria-hidden /> : check.verdict === "unknown" ? <Ruler size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
              {result.confidence === "estimated" && check.verdict !== "unknown" ? "Estimated · " : ""}{states[check.verdict]}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{check.reason}</p>
        </motion.li>
      ))}
    </ul>
  );
}

export default FitSheet;
