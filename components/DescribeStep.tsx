"use client";

/*
 * Step 2 of /design — Describe.
 *
 * The photo shrinks upward into a thumbnail with the selection still
 * highlighted, so the user keeps their bearings, then one big field and a row
 * of chips generated from THIS room's analysis. Small, fast, never dead-ends:
 * an empty field is a valid submit.
 *
 * <img> rather than next/image on purpose: the room photo is a client-side
 * data URL with no width known at build time, and next/image cannot optimise
 * a data URL.
 */
/* eslint-disable @next/next/no-img-element */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { RoomAnalysis } from "@/types";

/** What we ask for when the user says nothing. Never dead-end on a blank field. */
export const DEFAULT_PROMPT =
  "enhance this space using the room's existing palette";

export type DescribeStepProps = {
  /** called with the final prompt text; the caller routes on immediately */
  onSubmit: (prompt: string) => void;
  /** back to the selection step */
  onBack?: () => void;
};

/* ------------------------------------------------------------- suggestions */

/**
 * Chips come from the room's own analysis, not a hardcoded list. /api/analyze
 * may hand us suggestions directly; if it only gives us a palette, a room type
 * and a lighting word, we build the chips out of those here.
 */

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** Plain colour words, so a chip can say "keep the sage wall". */
const COLOUR_WORDS: Array<{ name: string; rgb: Rgb }> = [
  { name: "cream", rgb: { r: 244, g: 236, b: 219 } },
  { name: "oat", rgb: { r: 214, g: 199, b: 172 } },
  { name: "clay", rgb: { r: 181, g: 121, b: 92 } },
  { name: "rust", rgb: { r: 156, g: 78, b: 48 } },
  { name: "sage", rgb: { r: 143, g: 163, b: 132 } },
  { name: "olive", rgb: { r: 111, g: 112, b: 63 } },
  { name: "slate", rgb: { r: 106, g: 120, b: 133 } },
  { name: "charcoal", rgb: { r: 58, g: 56, b: 53 } },
  { name: "walnut", rgb: { r: 95, g: 67, b: 47 } },
  { name: "chalk", rgb: { r: 236, g: 236, b: 233 } },
];

function nearestColourWord(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  let best = COLOUR_WORDS[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of COLOUR_WORDS) {
    const d =
      (c.rgb.r - rgb.r) ** 2 + (c.rgb.g - rgb.g) ** 2 + (c.rgb.b - rgb.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name;
}

function isWarm(hex: string): boolean {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  return rgb.r > rgb.b;
}

export function buildSuggestions(analysis: RoomAnalysis | null): string[] {
  // the route already thought about this room — use its words
  const given = analysis?.suggestions?.filter((s) => s.trim().length > 0) ?? [];
  if (given.length > 0) return given.slice(0, 6);

  const palette = analysis?.palette ?? [];
  const warm =
    palette.length === 0
      ? true
      : palette.filter(isWarm).length * 2 >= palette.length;
  const room = (analysis?.roomType ?? "").toLowerCase();
  const light = (analysis?.lighting ?? "").toLowerCase();

  const out: string[] = [];
  out.push(warm ? "a warm boho reading nook" : "a calm, cool-toned corner");

  if (room.includes("bed")) out.push("a place to read before bed");
  else if (room.includes("kitchen") || room.includes("dining"))
    out.push("somewhere to eat that isn't the sofa");
  else if (room.includes("office") || room.includes("desk"))
    out.push("mid-century corner desk");
  else out.push("somewhere to actually sit");

  if (light.includes("dim") || light.includes("low") || light.includes("dark"))
    out.push("one big lamp instead of the overhead");
  else out.push("plants and soft light");

  const word = palette.length > 0 ? nearestColourWord(palette[0]) : null;
  if (word) out.push(`keep the ${word} wall, change the rest`);

  out.push(warm ? "layered rugs and wood" : "clean lines, less stuff");
  return out.slice(0, 6);
}

/* ------------------------------------------------------------- the screen */

export function DescribeStep({ onSubmit, onBack }: DescribeStepProps) {
  const room = useStore((s) => s.roomImage);
  const mask = useStore((s) => s.mask);
  const bbox = useStore((s) => s.bbox);
  const analysis = useStore((s) => s.roomAnalysis);
  const storedPrompt = useStore((s) => s.prompt);
  const setPrompt = useStore((s) => s.setPrompt);

  const reduced = useReducedMotion();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState(storedPrompt);

  const suggestions = React.useMemo(
    () => buildSuggestions(analysis),
    [analysis]
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const final = text.trim() || DEFAULT_PROMPT;
    setPrompt(final);
    onSubmit(final);
  };

  const choose = (chip: string) => {
    setText(chip);
    setPrompt(chip);
    // the chip fills the field; the user can still edit it
    inputRef.current?.focus();
  };

  /*
   * The frame carries the photo's own aspect ratio, so the mask PNG — which is
   * the full frame at the source resolution — lines up pixel for pixel with no
   * letterbox maths.
   */
  const aspect = room ? `${room.width} / ${room.height}` : "4 / 3";
  const maskStyle: React.CSSProperties | undefined = mask
    ? {
        WebkitMaskImage: `url(${mask.pngDataUrl})`,
        maskImage: `url(${mask.pngDataUrl})`,
        WebkitMaskSize: "100% 100%",
        maskSize: "100% 100%",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
      }
    : undefined;

  const bboxStyle: React.CSSProperties | undefined =
    bbox && room
      ? {
          left: `${(bbox.x / room.width) * 100}%`,
          top: `${(bbox.y / room.height) * 100}%`,
          width: `${(bbox.width / room.width) * 100}%`,
          height: `${(bbox.height / room.height) * 100}%`,
        }
      : undefined;

  const spring = reduced
    ? { duration: 0.15 }
    : ({ type: "spring", stiffness: 340, damping: 32 } as const);

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-5 pt-3">
        {/* the photo, shrunk — a layout transition from the canvas, not a remount */}
        <motion.div
          layoutId="room-frame"
          transition={spring}
          style={{ aspectRatio: aspect }}
          className="relative mx-auto h-[168px] max-w-full overflow-hidden rounded-2xl border border-line bg-surface sm:h-[210px]"
        >
          {room ? (
            <>
              <img
                src={room.dataUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover opacity-45 saturate-50"
              />
              {mask ? (
                <img
                  src={room.dataUrl}
                  alt="The part of your room you selected"
                  style={maskStyle}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              {bboxStyle ? (
                <span
                  aria-hidden
                  style={bboxStyle}
                  className="absolute rounded-md border-2 border-accent"
                />
              ) : null}
            </>
          ) : null}
        </motion.div>

        <div>
          <label htmlFor="describe-prompt" className="sr-only">
            What should this corner become?
          </label>
          <Input
            id="describe-prompt"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              // iOS Safari: let the keyboard settle, then bring the field back
              window.setTimeout(() => {
                inputRef.current?.scrollIntoView({
                  block: "center",
                  behavior: reduced ? "auto" : "smooth",
                });
              }, 280);
            }}
            enterKeyHint="go"
            autoComplete="off"
            autoCapitalize="sentences"
            placeholder="a warm boho reading nook"
            className={cn(
              "font-display h-auto rounded-2xl border-line bg-surface px-4 py-4",
              "text-xl leading-relaxed md:text-xl"
            )}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Leave it empty and we&apos;ll work with the colours already in the
            room.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs tracking-wide text-muted-foreground">
            {analysis ? "From what we read in your photo" : "Somewhere to start"}
          </p>
          {/* one row, horizontally scrollable, full-bleed to the gutter edges */}
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {suggestions.map((chip) => {
              const active = text.trim() === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => choose(chip)}
                  className={cn(
                    "shrink-0 snap-start rounded-full border px-4 py-2.5 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-line bg-surface text-foreground/80 active:bg-accent/10"
                  )}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* sticky, so the phone keyboard can never hide the submit button */}
      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-background/92 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md">
        <Button
          type="submit"
          className="h-[52px] w-full rounded-full text-base"
        >
          Redesign this corner
        </Button>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="mt-2 h-11 w-full text-sm text-muted-foreground"
          >
            Change what&apos;s selected
          </button>
        ) : null}
      </div>
    </form>
  );
}

export default DescribeStep;
