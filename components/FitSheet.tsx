"use client";

import * as React from "react";
import { Check, Ruler, TriangleAlert, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { InsideFitSheet, failHeadline, fitTone, productPasses } from "@/components/FitBadge";
import ProductCard from "@/components/ProductCard";
import { ProfileSheet } from "@/components/ProfileSheet";
import { Sheet } from "@/components/ui/Sheet";
import { NumberPlate, formatCarton } from "@/components/ui/NumberPlate";
import { planarCornerLimit, type FitResult } from "@/lib/fit";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * The fit check, explained.
 *
 * Every number printed here comes out of lib/fit.ts. The decisive sentence is
 * the kernel's own `reason`, word for word — it is the sentence said out loud
 * on stage, so it is not reworded, re-rounded or softened here.
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

export function FitSheet({ open, onOpenChange, product, result }: FitSheetProps) {
  const profile = useStore((s) => s.profile);
  const products = useStore((s) => s.products);
  const [profileOpen, setProfileOpen] = React.useState(false);

  const geometry = React.useMemo(() => {
    if (!product.dimsMm) return null;
    const [l, m, s] = [...product.dimsMm].sort((a, b) => b - a);
    const { limit, atDeg } = planarCornerLimit(
      profile.hallwayWidthMm,
      profile.landingWidthMm,
      s
    );
    const phi =
      limit !== null && limit > 0 && l > limit
        ? Math.acos(Math.min(1, limit / l))
        : 0;
    return {
      l,
      m,
      s,
      limit,
      atDeg,
      phi,
      headroom: l * Math.sin(phi) + m * Math.cos(phi),
    };
  }, [product.dimsMm, profile.hallwayWidthMm, profile.landingWidthMm]);

  const alternatives = React.useMemo(() => {
    if (!result || result.verdict !== "fail") return [];
    const sameElement = products.filter(
      (p) => p.id !== product.id && p.elementId === product.elementId && productPasses(p, profile)
    );
    const pool =
      sameElement.length > 0
        ? sameElement
        : products.filter((p) => p.id !== product.id && productPasses(p, profile));
    return [...pool].sort((a, b) => a.priceCents - b.priceCents).slice(0, 2);
  }, [products, product.id, product.elementId, profile, result]);

  const tone = fitTone(result);
  const headline = !result
    ? "Can't check this one"
    : result.verdict === "pass"
      ? "It fits"
      : result.verdict === "tight"
        ? "It fits, barely"
        : failHeadline(result.binding);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        snapPoints={[0.9]}
        initialSnap={0}
        label="Fit check"
      >
        <div className="flex flex-col gap-5 pb-4">
          <header className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Fit check
            </p>
            <h2
              className={cn(
                "font-display text-2xl font-semibold",
                tone === "ok" && "text-ok",
                tone === "warn" && "text-warn",
                tone === "accent" && "text-accent"
              )}
            >
              {headline}
            </h2>
            <p className="line-clamp-1 text-sm text-muted-foreground">{product.title}</p>
          </header>

          {geometry ? (
            <PlanView
              hallMm={profile.hallwayWidthMm}
              landingMm={profile.landingWidthMm}
              lengthMm={geometry.l}
              depthMm={geometry.s}
              turnDeg={geometry.atDeg ?? 45}
              tiltDeg={(geometry.phi * 180) / Math.PI}
            />
          ) : null}

          {geometry && geometry.phi > 0 ? (
            <Elevation
              lengthMm={geometry.l}
              midMm={geometry.m}
              tiltDeg={(geometry.phi * 180) / Math.PI}
              headroomMm={geometry.headroom}
              ceilingMm={profile.ceilingHeightMm}
            />
          ) : null}

          {/* the kernel's own sentence, verbatim */}
          <p className="font-display text-lg leading-snug">
            {result ? result.reason : "This listing does not publish its packed size, so there is nothing to measure against your doorways."}
          </p>

          {result && result.marginMm !== null ? (
            <NumberPlate
              value={result.marginMm}
              unit="mm"
              size="lg"
              tone={tone === "muted" ? "muted" : tone}
              source={
                result.marginMm < 0
                  ? "short of your landing"
                  : "clearance at the tightest point"
              }
            />
          ) : null}

          <Checks
            result={result}
            geometry={geometry}
            doorWidthMm={profile.doorWidthMm}
            doorHeightMm={profile.doorHeightMm}
            ceilingMm={profile.ceilingHeightMm}
          />

          <p className="text-xs leading-relaxed text-muted-foreground">
            Measured against your doorways: {mm.format(profile.doorWidthMm)} ×{" "}
            {mm.format(profile.doorHeightMm)} mm door, {mm.format(profile.hallwayWidthMm)} mm
            hallway into a {mm.format(profile.landingWidthMm)} mm landing,{" "}
            {mm.format(profile.ceilingHeightMm)} mm ceiling. The box is treated as a
            rectangular prism; the corridor&rsquo;s length is not counted.
          </p>

          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="h-11 w-full rounded-full border border-line bg-background text-sm font-medium hover:bg-muted"
          >
            Change your measurements
          </button>

          {result?.verdict === "fail" ? (
            <section className="flex flex-col gap-3">
              <h3 className="font-display text-lg font-semibold">Try these instead</h3>
              {alternatives.length > 0 ? (
                <InsideFitSheet.Provider value>
                  <div className="flex flex-col gap-2">
                    {alternatives.map((p) => (
                      <ProductCard key={p.id} product={p} compact />
                    ))}
                  </div>
                </InsideFitSheet.Provider>
              ) : (
                <div className="rounded-xl border border-line bg-muted/40 p-3 text-sm">
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
                    className="mt-2 inline-flex h-11 items-center text-sm font-medium text-accent underline underline-offset-2"
                  >
                    Search a smaller one
                  </a>
                </div>
              )}
            </section>
          ) : null}

          <p className="font-mono text-[11px] text-muted-foreground">
            {formatCarton(product.dimsMm) ?? "No size on the listing"}
            {product.dimsMm
              ? product.dimsSource === "quoted"
                ? ` — from the ${product.retailer} listing`
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

type PlanProps = {
  hallMm: number;
  landingMm: number;
  lengthMm: number;
  depthMm: number;
  turnDeg: number;
  tiltDeg: number;
};

/**
 * Plan view: the hallway meeting the landing at a right angle, with the box
 * drawn at its real proportions, turning the corner and then tilting up (which
 * from above reads as the footprint shortening to length × cos(tilt)).
 */
function PlanView({ hallMm, landingMm, lengthMm, depthMm, turnDeg, tiltDeg }: PlanProps) {
  const reduced = useReducedMotion();

  const W = 320;
  const H = 200;
  const pad = 14;
  // everything is drawn in millimetres, then scaled once
  const spanX = landingMm + Math.max(lengthMm, hallMm) * 1.1;
  const spanY = hallMm + Math.max(lengthMm, landingMm) * 1.1;
  const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const hall = hallMm * k;
  const landing = landingMm * k;
  const len = lengthMm * k;
  const depth = depthMm * k;

  const foreshortened = Math.cos((tiltDeg * Math.PI) / 180);
  const turn = 90 - turnDeg;

  const keyframes = reduced
    ? { x: pad + landing * 0.6 + len / 2, y: pad + hall / 2, rotate: 0, scaleX: foreshortened }
    : {
        x: [pad + hall / 2, pad + hall / 2, pad + hall * 0.7, pad + landing + len * 0.35, pad + landing + len * 0.35],
        y: [H - pad - len / 2, pad + hall + len * 0.6, pad + hall * 0.9, pad + landing / 2, pad + landing / 2],
        rotate: [90, 90, turn, 0, 0],
        scaleX: [1, 1, 1, 1, foreshortened],
      };

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-xl border border-line bg-background"
        role="img"
        aria-label="Plan view of the box turning from your hallway onto the landing, then tilting up."
      >
        {/* the corridor walls: outer corner top-left, inner corner offset by both widths */}
        <path
          d={`M ${W - pad} ${pad} L ${pad} ${pad} L ${pad} ${H - pad}`}
          fill="none"
          stroke="var(--line)"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <path
          d={`M ${W - pad} ${pad + landing} L ${pad + hall} ${pad + landing} L ${pad + hall} ${H - pad}`}
          fill="none"
          stroke="var(--line)"
          strokeWidth={3}
          strokeLinejoin="round"
        />

        <text x={pad + hall + 6} y={H - pad - 4} className="fill-[var(--muted)] text-[9px]">
          hallway {mm.format(hallMm)} mm
        </text>
        <text x={W - pad - 4} y={pad + landing + 12} textAnchor="end" className="fill-[var(--muted)] text-[9px]">
          landing {mm.format(landingMm)} mm
        </text>

        <motion.g
          style={{ transformBox: "view-box", transformOrigin: "0px 0px" }}
          initial={false}
          animate={keyframes}
          transition={
            reduced
              ? { duration: 0.15 }
              : {
                  duration: 1.8,
                  times: [0, 0.3, 0.55, 0.8, 1],
                  ease: "easeInOut",
                  repeat: Infinity,
                  repeatDelay: 0.9,
                }
          }
        >
          <rect
            x={-len / 2}
            y={-depth / 2}
            width={len}
            height={depth}
            rx={2}
            fill="var(--accent)"
            fillOpacity={0.12}
            stroke="var(--accent)"
            strokeWidth={2}
          />
        </motion.g>
      </svg>
      <figcaption className="text-[11px] text-muted-foreground">
        {mm.format(lengthMm)} mm long, {mm.format(depthMm)} mm thick, drawn to scale
        against your corridor.
      </figcaption>
    </figure>
  );
}

/** Side view: how far it has to lean, and what that costs in headroom. */
function Elevation({
  lengthMm,
  midMm,
  tiltDeg,
  headroomMm,
  ceilingMm,
}: {
  lengthMm: number;
  midMm: number;
  tiltDeg: number;
  headroomMm: number;
  ceilingMm: number;
}) {
  const reduced = useReducedMotion();
  const W = 320;
  const H = 130;
  const pad = 14;
  const k = (H - pad * 2) / Math.max(ceilingMm, headroomMm * 1.05);
  const ceilingY = H - pad - ceilingMm * k;
  const len = lengthMm * k;
  const thick = midMm * k;

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-xl border border-line bg-background"
        role="img"
        aria-label={`Side view: leaning ${tiltDeg.toFixed(1)} degrees needs ${mm.format(
          Math.round(headroomMm)
        )} millimetres of headroom under your ${mm.format(ceilingMm)} millimetre ceiling.`}
      >
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--line)" strokeWidth={3} />
        <line x1={pad} y1={ceilingY} x2={W - pad} y2={ceilingY} stroke="var(--line)" strokeWidth={3} />
        <text x={W - pad - 4} y={ceilingY + 12} textAnchor="end" className="fill-[var(--muted)] text-[9px]">
          ceiling {mm.format(ceilingMm)} mm
        </text>

        <motion.g
          style={{ transformBox: "view-box", transformOrigin: "0px 0px" }}
          initial={false}
          animate={
            reduced
              ? { x: W / 2, y: H - pad, rotate: -tiltDeg }
              : { x: W / 2, y: H - pad, rotate: [0, 0, -tiltDeg, -tiltDeg] }
          }
          transition={
            reduced
              ? { duration: 0.15 }
              : { duration: 1.8, times: [0, 0.5, 0.85, 1], ease: "easeInOut", repeat: Infinity, repeatDelay: 0.9 }
          }
        >
          <rect
            x={-len / 2}
            y={-thick}
            width={len}
            height={thick}
            rx={2}
            fill="var(--accent)"
            fillOpacity={0.12}
            stroke="var(--accent)"
            strokeWidth={2}
          />
        </motion.g>

        <line
          x1={pad + 6}
          y1={H - pad}
          x2={pad + 6}
          y2={H - pad - headroomMm * k}
          stroke="var(--accent)"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
        <text x={pad + 12} y={H - pad - headroomMm * k + 10} className="fill-[var(--accent)] text-[9px]">
          needs {mm.format(Math.round(headroomMm))} mm
        </text>
      </svg>
      <figcaption className="text-[11px] text-muted-foreground">
        Leaning it {tiltDeg.toFixed(1)}° is what turns the corner — and what costs the
        headroom.
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------- the checks */

type Geometry = {
  l: number;
  m: number;
  s: number;
  limit: number | null;
  atDeg: number | null;
  phi: number;
  headroom: number;
};

type Row = {
  key: string;
  name: string;
  state: "pass" | "fail" | "skip";
  decisive: boolean;
  detail: string;
};

function Checks({
  result,
  geometry,
  doorWidthMm,
  doorHeightMm,
  ceilingMm,
}: {
  result: FitResult | null;
  geometry: Geometry | null;
  doorWidthMm: number;
  doorHeightMm: number;
  ceilingMm: number;
}) {
  if (!result || !geometry) {
    return (
      <p className="rounded-xl border border-line bg-muted/40 p-3 text-sm text-muted-foreground">
        Three checks run on every box — the door, the turn onto the landing, and the
        headroom it needs while it leans. None of them can run without a size.
      </p>
    );
  }

  const b = result.binding;
  const flatPack = b === "flat_pack";
  const clearedDoor = !flatPack && b !== "door";
  const turnedFlat = b === "corner_flat";
  const neededTilt = b === "corner_tilted" || b === "headroom";

  const rows: Row[] = flatPack
    ? [
        {
          key: "flat",
          name: "Flat-packed",
          state: "pass",
          decisive: true,
          detail: "It arrives in boxes, so the assembled size never has to turn a corner.",
        },
      ]
    : [
        {
          key: "door",
          name: "Door",
          state: b === "door" ? "fail" : "pass",
          decisive: b === "door",
          detail:
            b === "door"
              ? result.reason
              : `Its ${mm.format(geometry.s)} × ${mm.format(geometry.m)} mm face goes through your ${mm.format(doorWidthMm)} × ${mm.format(doorHeightMm)} mm opening.`,
        },
        {
          key: "corner",
          name: "Corner",
          state: b === "corner" ? "fail" : clearedDoor ? "pass" : "skip",
          decisive: b === "corner" || turnedFlat,
          detail:
            b === "corner"
              ? "No angle turns something this thick between those two widths."
              : !clearedDoor
                ? "Not reached — it stopped at the door."
                : turnedFlat
                  ? `Turns flat at ${geometry.atDeg?.toFixed(1)}°; your landing takes ${mm.format(
                      Math.round(geometry.limit ?? 0)
                    )} mm lying down and it is ${mm.format(geometry.l)} mm.`
                  : `Flat it would have to be under ${mm.format(
                      Math.round(geometry.limit ?? 0)
                    )} mm. It is ${mm.format(geometry.l)} mm, so it has to lean.`,
        },
        {
          key: "headroom",
          name: "Headroom",
          state: !clearedDoor || b === "corner" ? "skip" : neededTilt ? (result.verdict === "fail" ? "fail" : "pass") : "skip",
          decisive: neededTilt,
          detail:
            !clearedDoor || b === "corner"
              ? "Not reached."
              : neededTilt
                ? `Leaning it needs ${mm.format(Math.round(geometry.headroom))} mm above the landing; you have ${mm.format(ceilingMm)} mm.`
                : "Not needed — it never leaves the floor.",
        },
      ];

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cn(
            "flex gap-2.5 rounded-xl border p-3",
            row.decisive ? "border-foreground/25 bg-muted/50" : "border-line bg-surface"
          )}
        >
          <span className="mt-0.5 shrink-0">
            {row.state === "pass" ? (
              <Check className="size-4 text-ok" aria-hidden />
            ) : row.state === "fail" ? (
              <XCircle className="size-4 text-accent" aria-hidden />
            ) : (
              <Ruler className="size-4 text-muted-foreground" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              {row.name}
              {row.decisive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/70">
                  <TriangleAlert className="size-2.5" aria-hidden />
                  decided it
                </span>
              ) : null}
            </p>
            <p className="text-sm text-muted-foreground">{row.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default FitSheet;
