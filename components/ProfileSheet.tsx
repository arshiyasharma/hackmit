"use client";

import * as React from "react";
import { Check, Ruler } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/input";
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
 */

const MM_PER_INCH = 25.4;

type FieldSpec = {
  id: ProfileField;
  label: string;
  /** what to put the tape on — people guess "landing width" wrong */
  help: string;
  art: React.ReactNode;
};

/* Stroke-only illustrations: 56 × 44, line colour for the room, accent for the
   dimension being measured. No icon font, no image files. */
function Art({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 56 44"
      className="size-11 shrink-0 rounded-lg border border-line bg-background p-0.5"
      aria-hidden
      fill="none"
      stroke="var(--line)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ACCENT = { stroke: "var(--accent)" } as const;

const FIELDS: FieldSpec[] = [
  {
    id: "doorWidthMm",
    label: "Door width",
    help: "Inside the frame, at the narrowest door it has to pass.",
    art: (
      <Art>
        <path d="M14 6 v32 M42 6 v32 M8 38 h40" />
        <path d="M14 30 h28" {...ACCENT} />
        <path d="M14 27 v6 M42 27 v6" {...ACCENT} />
      </Art>
    ),
  },
  {
    id: "doorHeightMm",
    label: "Door height",
    help: "Floor to the underside of the door frame.",
    art: (
      <Art>
        <path d="M14 8 h28 v30 M8 38 h40" />
        <path d="M24 10 v26" {...ACCENT} />
        <path d="M21 10 h6 M21 36 h6" {...ACCENT} />
      </Art>
    ),
  },
  {
    id: "hallwayWidthMm",
    label: "Hallway width",
    help: "Wall to wall, where the hallway runs into the stairs.",
    art: (
      <Art>
        <path d="M16 4 v36 M40 4 v36" />
        <path d="M16 22 h24" {...ACCENT} />
        <path d="M16 19 v6 M40 19 v6" {...ACCENT} />
      </Art>
    ),
  },
  {
    id: "landingWidthMm",
    label: "Stair landing width",
    help: "The flat square where the stairs turn — wall to banister, not the step.",
    art: (
      <Art>
        <path d="M6 38 h18 v-10 h18 v-10 h8" />
        <path d="M24 33 h18" {...ACCENT} />
        <path d="M24 30 v6 M42 30 v6" {...ACCENT} />
      </Art>
    ),
  },
  {
    id: "ceilingHeightMm",
    label: "Ceiling at the landing",
    help: "Floor to ceiling at that landing — this is the one that stops tall boxes.",
    art: (
      <Art>
        <path d="M6 8 h44 M6 38 h44" />
        <path d="M28 10 v26" {...ACCENT} />
        <path d="M25 10 h6 M25 36 h6" {...ACCENT} />
      </Art>
    ),
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

  const measuredCount = FIELDS.filter((f) => profile.measured[f.id]).length;

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
    >
      <div className="flex flex-col gap-4 pb-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Your doorways</h2>
            <p className="text-sm text-muted-foreground">
              Five numbers decide whether furniture reaches the room. Measure the ones
              you can; the rest stay assumptions and say so.
            </p>
          </div>

          <div
            role="group"
            aria-label="Units"
            className="flex shrink-0 overflow-hidden rounded-full border border-line"
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
                className={cn(
                  "h-11 w-11 text-sm font-medium transition-colors",
                  units === u
                    ? "bg-accent text-[var(--on-accent)]"
                    : "bg-background text-muted-foreground hover:bg-muted"
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </header>

        <ul className="flex flex-col gap-3">
          {FIELDS.map((field) => {
            const isMeasured = Boolean(profile.measured[field.id]);
            const value = draft[field.id] ?? toDisplay(profile[field.id], units);

            return (
              <li key={field.id} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
                {field.art}

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label
                    htmlFor={`profile-${field.id}`}
                    className="text-sm font-medium leading-tight"
                  >
                    {field.label}
                  </label>
                  <p className="text-xs leading-snug text-muted-foreground">{field.help}</p>

                  <div className="flex items-center gap-2">
                    <Input
                      id={`profile-${field.id}`}
                      inputMode="decimal"
                      type="text"
                      autoComplete="off"
                      value={value}
                      className="h-11 w-28 font-mono tabular"
                      onChange={(e) => {
                        const raw = e.target.value;
                        setDraft((d) => ({ ...d, [field.id]: raw }));
                        const next = toMm(raw, units);
                        if (next !== null) measure(field.id, next);
                      }}
                      onBlur={() =>
                        setDraft((d) => {
                          // drop the raw keystrokes and fall back to the stored mm
                          const next = { ...d };
                          delete next[field.id];
                          return next;
                        })
                      }
                    />
                    <span className="text-sm text-muted-foreground">{units}</span>

                    {units === "in" ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        = {mm.format(profile[field.id])} mm
                      </span>
                    ) : null}
                  </div>

                  <MeasuredFlag measured={isMeasured} />
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          {measuredCount} of {FIELDS.length} measured. Kept on this phone, so you are
          never asked again.
        </p>

        <button
          type="button"
          onClick={() => {
            clearDrafts();
            onOpenChange(false);
          }}
          className="h-11 w-full rounded-full bg-accent text-sm font-medium text-[var(--on-accent)]"
        >
          Done
        </button>
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
      transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "inline-flex items-center gap-1 text-xs",
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
        className={cn(
          "inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-3",
          "text-sm font-medium hover:bg-muted",
          className
        )}
      >
        <Ruler className="size-4 text-muted-foreground" aria-hidden />
        <span>Your doorways</span>
        <span className={cn("text-xs", count > 0 ? "text-ok" : "text-muted-foreground")}>
          {state}
        </span>
      </button>

      <ProfileSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export default ProfileSheet;
