"use client";

import * as React from "react";
import { Check, Ruler } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/input";
import { DUR, EASE, REDUCED, cssEase } from "@/lib/motion";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ProfileField } from "@/types";

/**
 * Where the five measurements are entered.
 *
 * Stored value is ALWAYS millimetres. `units` is a display preference, so the
 * inches toggle converts on the way in and on the way out and never changes
 * what the fit kernel reads.
 *
 * A field starts on a sensible assumption, in muted text. The moment it is
 * edited it flips to "you measured this" in the ok colour — the same honesty
 * rule as a quoted dimension versus an estimated one. The store persists the
 * profile to localStorage, so nobody is asked twice.
 *
 * It is drawn in the fit check's register (beat 07): a blueprint. The form is
 * a schedule of five mono figures; beside it one line drawing of the way in,
 * where the dimension you are typing into is the one that lights up — people
 * guess "landing width" wrong, and a picture is quicker than the sentence.
 */

const MM_PER_INCH = 25.4;

/* ------------------------------------------------------------- blueprint */

const GRID_LINE = "color-mix(in srgb, var(--accent) 9%, transparent)";

/** The drafting grid: 8px squares, faint enough to sit under a 1px drawing. */
const BLUEPRINT_GROUND: React.CSSProperties = {
  backgroundImage: `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`,
  backgroundSize: "8px 8px",
};

/**
 * The sheet of drafting paper every fit drawing sits on. Solid, not glass: it
 * lives inside a glass dialog, and a drawing has to be read.
 */
export function Blueprint({ className, style, ...rest }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-[22px] border border-accent-pale bg-accent-wash", className)}
      style={{ ...BLUEPRINT_GROUND, ...style }}
      {...rest}
    />
  );
}

/** Hovers and chips: the motion table's `micro`, for CSS transitions. */
const MICRO: React.CSSProperties = {
  transitionDuration: `${DUR.micro}s`,
  transitionTimingFunction: cssEase("out"),
};

/* No `outline-none` beside it: in Tailwind 4 that sets --tw-outline-style to
   none, and `outline-2` reads the same variable — the ring would never draw. */
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/* ----------------------------------------------------------------- fields */

type FieldSpec = {
  id: ProfileField;
  label: string;
  /** what to put the tape on — people guess "landing width" wrong */
  help: string;
};

const FIELDS: FieldSpec[] = [
  {
    id: "doorWidthMm",
    label: "Door width",
    help: "Inside the frame, at the narrowest door it has to pass.",
  },
  {
    id: "doorHeightMm",
    label: "Door height",
    help: "Floor to the underside of the door frame.",
  },
  {
    id: "hallwayWidthMm",
    label: "Hallway width",
    help: "Wall to wall, where the hallway runs into the stairs.",
  },
  {
    id: "landingWidthMm",
    label: "Stair landing width",
    help: "The flat square where the stairs turn — wall to banister, not the step.",
  },
  {
    id: "ceilingHeightMm",
    label: "Ceiling at the landing",
    help: "Floor to ceiling at that landing — this is the one that stops tall boxes.",
  },
];

const mm = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function toDisplay(valueMm: number, units: "mm" | "in"): string {
  if (units === "in") return String(Math.round((valueMm / MM_PER_INCH) * 10) / 10);
  return String(Math.round(valueMm));
}

function toMm(raw: string, units: "mm" | "in"): number | null {
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(units === "in" ? n * MM_PER_INCH : n);
}

function focusField(id: ProfileField) {
  document.getElementById(`profile-${id}`)?.focus();
}

/* ---------------------------------------------------------------- drawing */

/**
 * The way in, as two small views: a section through the door, the stairs and
 * the landing, and a plan of the hallway turning onto that landing. A
 * schematic, NOT to scale — the to-scale drawing is the fit check's. Its one
 * job is to say which of the five dimensions a field means, so only the
 * active one carries a figure.
 *
 * Hidden from assistive tech: every dimension here is a labelled input next
 * door. Clicking a dimension line is a mouse shortcut to that input.
 */
type DimSpec = {
  id: ProfileField;
  view: "section" | "plan";
  /** the dimension line, end to end */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** where its figure is written */
  tx: number;
  ty: number;
  anchor: "start" | "middle" | "end";
};

const DIMS: DimSpec[] = [
  { id: "doorWidthMm", view: "section", x1: 40, y1: 118, x2: 88, y2: 118, tx: 64, ty: 110, anchor: "middle" },
  { id: "doorHeightMm", view: "section", x1: 102, y1: 44, x2: 102, y2: 132, tx: 109, ty: 84, anchor: "start" },
  { id: "ceilingHeightMm", view: "section", x1: 238, y1: 18, x2: 238, y2: 96, tx: 231, ty: 60, anchor: "end" },
  { id: "hallwayWidthMm", view: "plan", x1: 16, y1: 124, x2: 62, y2: 124, tx: 71, ty: 128, anchor: "start" },
  { id: "landingWidthMm", view: "plan", x1: 118, y1: 16, x2: 118, y2: 62, tx: 127, ty: 43, anchor: "start" },
];

const STROKE = {
  fill: "none",
  strokeWidth: 1,
  vectorEffect: "non-scaling-stroke",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function DimLine({
  dim,
  active,
  figure,
  onPick,
  onHover,
}: {
  dim: DimSpec;
  active: boolean;
  figure: string;
  onPick: () => void;
  onHover: (on: boolean) => void;
}) {
  const horizontal = dim.y1 === dim.y2;
  const tick = 4;
  const ticks = horizontal
    ? `M ${dim.x1} ${dim.y1 - tick} V ${dim.y1 + tick} M ${dim.x2} ${dim.y2 - tick} V ${dim.y2 + tick}`
    : `M ${dim.x1 - tick} ${dim.y1} H ${dim.x1 + tick} M ${dim.x2 - tick} ${dim.y2} H ${dim.x2 + tick}`;
  const line = `M ${dim.x1} ${dim.y1} L ${dim.x2} ${dim.y2}`;

  return (
    <g
      className="cursor-pointer"
      onClick={onPick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* a fat invisible stroke, so a 1px line is not a 1px target */}
      <path d={line} stroke="transparent" strokeWidth={16} fill="none" pointerEvents="stroke" />
      <path
        d={`${line} ${ticks}`}
        {...STROKE}
        strokeWidth={active ? 1.5 : 1}
        stroke="var(--accent)"
        strokeOpacity={active ? 1 : 0.4}
        className="transition-[stroke-opacity]"
        style={MICRO}
      />
      <text
        x={dim.tx}
        y={dim.ty}
        textAnchor={dim.anchor}
        className="tabular fill-foreground font-mono text-[12px] transition-opacity"
        style={{ ...MICRO, opacity: active ? 1 : 0 }}
      >
        {figure}
      </text>
    </g>
  );
}

function WayIn({
  active,
  figure,
  onPick,
  onHover,
}: {
  active: ProfileField;
  figure: (id: ProfileField) => string;
  onPick: (id: ProfileField) => void;
  onHover: (id: ProfileField | null) => void;
}) {
  const dims = (view: DimSpec["view"]) =>
    DIMS.filter((d) => d.view === view).map((d) => (
      <DimLine
        key={d.id}
        dim={d}
        active={d.id === active}
        figure={figure(d.id)}
        onPick={() => onPick(d.id)}
        onHover={(on) => onHover(on ? d.id : null)}
      />
    ));

  return (
    // capped, so a wide single-column window does not get a poster of a door
    <div className="mx-auto flex w-full max-w-[20rem] flex-col gap-3" aria-hidden>
      <div>
        <p className="eyebrow mb-1 text-muted-foreground">Section</p>
        <svg viewBox="0 0 280 150" className="block w-full">
          {/* ceiling, then the floor climbing the stairs to the landing */}
          <path
            d="M 10 18 H 270 M 10 132 H 150 V 120 H 166 V 108 H 182 V 96 H 270"
            {...STROKE}
            stroke="var(--accent)"
            strokeOpacity={0.55}
          />
          {/* the door frame */}
          <path d="M 40 132 V 44 H 88 V 132" {...STROKE} stroke="var(--accent)" />
          {dims("section")}
        </svg>
      </div>

      <div className="border-t border-accent-pale pt-3">
        <p className="eyebrow mb-1 text-muted-foreground">Plan</p>
        <svg viewBox="0 0 280 150" className="block w-full">
          {/* the hallway (running up) meeting the landing (running right) */}
          <path d="M 270 16 H 16 V 140" {...STROKE} stroke="var(--accent)" />
          <path d="M 270 62 H 62 V 140" {...STROKE} stroke="var(--accent)" />
          {/* the treads between them */}
          <path
            d="M 16 74 H 62 M 16 84 H 62 M 16 94 H 62 M 16 104 H 62"
            {...STROKE}
            stroke="var(--accent)"
            strokeOpacity={0.35}
          />
          {dims("plan")}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */

export type ProfileSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProfileSheet({ open, onOpenChange }: ProfileSheetProps) {
  const profile = useStore((s) => s.profile);
  const measure = useStore((s) => s.measure);
  const setProfile = useStore((s) => s.setProfile);
  const units = profile.units;

  // raw keystrokes live here so "76" on the way to "762" is not committed as 76
  const [draft, setDraft] = React.useState<Partial<Record<ProfileField, string>>>({});
  const clearDrafts = React.useCallback(() => setDraft({}), []);

  /*
   * Which dimension the drawing lights up: the field being typed into, else
   * the row under the mouse, else whichever of those it was last — so the
   * drawing never snaps back to the door while the hand is on its way over.
   */
  const [focused, setFocused] = React.useState<ProfileField | null>(null);
  const [hovered, setHovered] = React.useState<ProfileField | null>(null);
  const [last, setLast] = React.useState<ProfileField>(FIELDS[0].id);
  const active = focused ?? hovered ?? last;

  const hover = React.useCallback((id: ProfileField | null) => {
    setHovered(id);
    if (id) setLast(id);
  }, []);

  const doneRef = React.useRef<HTMLButtonElement>(null);

  const measuredCount = FIELDS.filter((f) => profile.measured[f.id]).length;
  const activeField = FIELDS.find((f) => f.id === active) ?? FIELDS[0];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) clearDrafts();
        onOpenChange(next);
      }}
      snapPoints={[0.9]}
      initialSnap={0}
      label="Your doorways"
      // two columns need a little more than the dialog's default measure
      className="desk:max-w-[54rem]"
    >
      <div className="flex flex-col gap-6">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="eyebrow text-muted-foreground">Fit check</p>
            <h2 className="mt-2 font-display text-[2.5rem] font-normal leading-none tracking-[0.01em] desk:text-[3rem]">
              Your doorways
            </h2>
            <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
              Five numbers decide whether furniture reaches the room. Measure the ones
              you can; the rest stay assumptions and say so.
            </p>
          </div>

          {/* 44px tall as a whole; each half keeps a 44px hit area through `tap` */}
          <div
            role="group"
            aria-label="Units"
            className="flex shrink-0 gap-1 rounded-full border border-line bg-surface p-1"
          >
            {(["mm", "in"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  clearDrafts();
                  setProfile({ units: u });
                }}
                aria-pressed={units === u}
                style={MICRO}
                className={cn(
                  "tap h-[34px] w-12 cursor-pointer rounded-full font-mono text-sm transition-colors",
                  FOCUS_RING,
                  units === u
                    ? "bg-accent text-[var(--on-accent)]"
                    : "text-muted-foreground hover:bg-accent-wash hover:text-foreground"
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-6 desk:grid-cols-[minmax(0,1fr)_18.5rem] desk:gap-8">
          <ul className="flex flex-col border-b border-line">
            {FIELDS.map((field, index) => {
              const isMeasured = Boolean(profile.measured[field.id]);
              const value = draft[field.id] ?? toDisplay(profile[field.id], units);
              const isActive = field.id === active;

              return (
                <li
                  key={field.id}
                  data-active={isActive}
                  onMouseEnter={() => hover(field.id)}
                  onMouseLeave={() => hover(null)}
                  style={MICRO}
                  className={cn(
                    "flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line px-3 py-3.5",
                    "transition-colors data-[active=true]:bg-accent-wash/70"
                  )}
                >
                  <span
                    aria-hidden
                    style={MICRO}
                    className={cn(
                      "tabular w-5 shrink-0 pt-0.5 font-mono text-[11px] transition-colors",
                      isActive ? "text-accent" : "text-muted-foreground"
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                    <label
                      htmlFor={`profile-${field.id}`}
                      className="cursor-pointer text-[15px] font-medium leading-tight"
                    >
                      {field.label}
                    </label>
                    <p className="max-w-[44ch] text-[13px] leading-snug text-muted-foreground">
                      {field.help}
                    </p>
                    <MeasuredFlag measured={isMeasured} />
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        id={`profile-${field.id}`}
                        inputMode="decimal"
                        type="text"
                        autoComplete="off"
                        value={value}
                        className="tabular h-11 w-28 rounded-xl border-line bg-surface px-3 text-right font-mono text-base md:text-base"
                        onChange={(e) => {
                          const raw = e.target.value;
                          setDraft((d) => ({ ...d, [field.id]: raw }));
                          const next = toMm(raw, units);
                          if (next !== null) measure(field.id, next);
                        }}
                        onFocus={(e) => {
                          setFocused(field.id);
                          setLast(field.id);
                          // a number you are about to replace, not edit
                          e.currentTarget.select();
                        }}
                        onKeyDown={(e) => {
                          // Enter walks the schedule: next figure, then Done
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const next = FIELDS[index + 1];
                          if (next) focusField(next.id);
                          else doneRef.current?.focus();
                        }}
                        onBlur={() => {
                          setFocused(null);
                          setDraft((d) => {
                            // drop the raw keystrokes and fall back to the stored mm
                            const next = { ...d };
                            delete next[field.id];
                            return next;
                          });
                        }}
                      />
                      <span className="w-6 font-mono text-sm text-muted-foreground">{units}</span>
                    </div>

                    {units === "in" ? (
                      <span className="tabular pr-8 font-mono text-[11px] text-muted-foreground">
                        = {mm.format(profile[field.id])} mm
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* first in a narrow window, so the picture is met before the form */}
          <Blueprint className="order-first self-start p-4 desk:sticky desk:top-2 desk:order-none">
            <WayIn
              active={active}
              figure={(id) => `${mm.format(profile[id])} mm`}
              onPick={focusField}
              onHover={hover}
            />
            <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-accent-pale pt-3">
              <span className="eyebrow text-accent">{activeField.label}</span>
              <span className="tabular font-mono text-sm">{mm.format(profile[active])} mm</span>
            </p>
          </Blueprint>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="text-[13px] text-muted-foreground">
            <span className="tabular font-mono text-foreground">{measuredCount}</span> of{" "}
            <span className="tabular font-mono text-foreground">{FIELDS.length}</span> measured.
            Kept in this browser, so you are never asked again.
          </p>

          <button
            ref={doneRef}
            type="button"
            onClick={() => {
              clearDrafts();
              onOpenChange(false);
            }}
            style={MICRO}
            className={cn(
              "glass-blue h-11 w-full cursor-pointer !rounded-full px-10 text-sm font-medium",
              "transition-[filter,transform] hover:brightness-110 active:scale-[0.98] desk:w-auto",
              FOCUS_RING
            )}
          >
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function MeasuredFlag({ measured }: { measured: boolean }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      key={measured ? "measured" : "assumed"}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? REDUCED : { duration: DUR.micro, ease: EASE.out }}
      className={cn(
        "mt-0.5 inline-flex items-center gap-1 font-mono text-[11px]",
        measured ? "text-ok" : "text-muted-foreground"
      )}
    >
      {measured ? <Check className="size-3" aria-hidden /> : <Ruler className="size-3" aria-hidden />}
      {measured ? "you measured this" : "assumed"}
    </motion.span>
  );
}

/* ----------------------------------------------------------------- button */

/**
 * The entry point, small enough to sit in the savings rail or a screen header.
 * It says which state the profile is in, because an assumed doorway that
 * decided a fit verdict has to be visible.
 *
 * A glass pill, so it can float over the room as well as sit on paper. It is
 * not mounted by this file: whoever owns a screen that talks about "your
 * measurements" (the checkout does) mounts it there.
 */
export function ProfileButton({ className }: { className?: string }) {
  const measured = useStore((s) => s.profile.measured);
  const [open, setOpen] = React.useState(false);

  const count = FIELDS.filter((f) => measured[f.id]).length;
  const state =
    count === 0 ? "assumed" : count === FIELDS.length ? "measured" : `${count} of 5 measured`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        style={MICRO}
        className={cn(
          "glass-pill inline-flex h-11 cursor-pointer items-center gap-2 px-4",
          "text-sm font-medium transition-transform hover:-translate-y-px active:translate-y-0",
          FOCUS_RING,
          className
        )}
      >
        <Ruler className="size-4 text-accent" aria-hidden />
        <span>Your doorways</span>
        <span
          className={cn(
            "tabular font-mono text-[11px]",
            count > 0 ? "text-ok" : "text-muted-foreground"
          )}
        >
          {state}
        </span>
      </button>

      <ProfileSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export default ProfileSheet;
