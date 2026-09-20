"use client";

/*
 * SCRATCH PAGE — not part of the product flow.
 *
 * It exists so every primitive can be checked in light AND dark at 390px wide
 * before six other screens are built on top of them. Nothing links here. Delete
 * it before the demo if you like; nothing imports it.
 */

import * as React from "react";
import { toast } from "sonner";

import AppShell from "@/components/AppShell";
import { Sheet } from "@/components/ui/Sheet";
import StatusLine from "@/components/ui/StatusLine";
import NumberPlate, { formatCarton } from "@/components/ui/NumberPlate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DEFAULT_PROFILE, useStore } from "@/lib/store";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-5">
      <h2 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        {title}
      </h2>
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
      <div className="mt-3">{children}</div>
      <Separator className="mt-5" />
    </section>
  );
}

export default function ScratchPage() {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [price, setPrice] = React.useState(124000); // cents
  const [text, setText] = React.useState("");

  const profile = useStore((s) => s.profile);
  const measure = useStore((s) => s.measure);

  return (
    <AppShell step="design" title="Scratch — primitives" showBack={false}>
      <div className="pb-24">
        <p className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          Scratch page. Every primitive lives here so light and dark can be
          checked at 390px. It is not part of the flow.
        </p>

        <Section
          title="NumberPlate"
          note="Display serif, tabular figures, unit inline, source underneath."
        >
          <div className="flex flex-wrap items-end gap-6">
            <NumberPlate
              value={price / 100}
              unit="$"
              size="lg"
              source="Wayfair listing"
              format={{ maximumFractionDigits: 0 }}
            />
            <NumberPlate
              value={2080}
              unit="mm"
              size="md"
              source="IKEA listing"
            />
            <NumberPlate
              value={1918}
              unit="mm"
              size="md"
              tone="warn"
              source="estimated"
            />
            <NumberPlate value={63} unit="%" size="md" source="cached" />
            <NumberPlate value={null} unit="minutes" size="md" source="no ledger yet" />
          </div>

          <p className="mt-4 font-mono text-xs text-muted-foreground">
            {formatCarton([1900, 720, 640])}
          </p>

          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => setPrice((c) => c + 4000)}>
              +$40
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPrice((c) => Math.max(0, c - 4000))}>
              -$40
            </Button>
          </div>
        </Section>

        <Section
          title="Buttons"
          note="Default must read terracotta, not shadcn black. If it is black, the token map in globals.css is wrong."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg">Redesign this corner</Button>
            <Button variant="outline">Upload a photo</Button>
            <Button variant="secondary">Swap</Button>
            <Button variant="ghost">Skip</Button>
            <Button variant="link">See the listing</Button>
            <Button disabled>Continue</Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="size-11 rounded-full bg-accent" aria-hidden />
            <span className="text-sm text-muted-foreground">
              this swatch and the button above must be the same colour
            </span>
          </div>
        </Section>

        <Section title="Palette">
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            {[
              ["background", "bg-background"],
              ["surface", "bg-surface"],
              ["foreground", "bg-foreground"],
              ["accent", "bg-accent"],
              ["line", "bg-line"],
              ["ok", "bg-ok"],
              ["warn", "bg-warn"],
              ["muted text", "bg-muted-foreground"],
            ].map(([name, cls]) => (
              <div key={name} className="flex flex-col gap-1">
                <span className={`h-12 rounded-lg border border-line ${cls}`} />
                <span className="text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type">
          <p className="font-display text-3xl font-semibold">
            Point at the part of the room you want to change.
          </p>
          <p className="mt-2 text-sm">
            Body is Instrument Sans. Headings and numbers are Fraunces. Never a
            serif button label.
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            1,900 × 720 × 640 mm — mono, for dimensions and tokens
          </p>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>New</Badge>
            <Badge variant="secondary">from #3</Badge>
            <Badge variant="outline">Out of stock</Badge>
            <Badge variant="ghost">estimated</Badge>
            <Badge className="bg-ok text-background">Fits — 222 mm to spare</Badge>
            <Badge className="bg-warn text-background">Tight — 40 mm to spare</Badge>
            <Badge className="bg-accent text-primary-foreground">
              Won&apos;t fit your stairs
            </Badge>
          </div>
        </Section>

        <Section title="Input">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="a warm boho reading nook"
            className="h-12 text-base"
          />
          <div className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              defaultValue={profile.doorWidthMm}
              onBlur={(e) => measure("doorWidthMm", Number(e.target.value))}
              className="h-11 w-32"
            />
            <span className="text-sm text-muted-foreground">
              door width, mm —{" "}
              {profile.measured.doorWidthMm ? (
                <span className="text-ok">you measured this</span>
              ) : (
                <span>assumed {DEFAULT_PROFILE.doorWidthMm} mm</span>
              )}
            </span>
          </div>
        </Section>

        <Section
          title="StatusLine"
          note="This replaces every spinner. Never a Loader icon."
        >
          <StatusLine
            messages={[
              "Reading the light in the room…",
              "Picking out your colours…",
              "Finding something to measure against…",
            ]}
            intervalMs={2000}
          />
        </Section>

        <Section title="Skeletons" note="The shape of the thing that is coming.">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="col-span-2 h-40 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        </Section>

        <Section title="ScrollArea">
          <ScrollArea className="h-28 rounded-xl border border-line p-3">
            <ul className="space-y-2 text-sm">
              {Array.from({ length: 12 }, (_, i) => (
                <li key={i}>Candidate {i + 1} — a real listing at a real shop</li>
              ))}
            </ul>
          </ScrollArea>
        </Section>

        <Section
          title="Sheet"
          note="react-modal-sheet. The only bottom sheet in the app."
        >
          <Button onClick={() => setSheetOpen(true)}>Open the sheet</Button>
        </Section>

        <Section title="Toast" note="sonner, styled to our tokens.">
          <Button
            variant="outline"
            onClick={() =>
              toast("Locked to real size — this chair is 780 mm tall.")
            }
          >
            Refuse a pinch
          </Button>
        </Section>

        <Section title="Tap targets" note="44px minimum, measured not eyeballed.">
          <div className="flex gap-3">
            <button
              type="button"
              className="size-11 rounded-full border border-line bg-surface text-sm"
            >
              44
            </button>
            <button
              type="button"
              className="tap size-6 rounded-full bg-accent text-[10px] text-primary-foreground"
              aria-label="small dot with a 44px hit area"
            />
          </div>
        </Section>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        snapPoints={[0.9, 0.4]}
        initialSnap={1}
        label="Sheet demo"
      >
        <div className="pt-2">
          <h3 className="font-display text-2xl font-semibold">
            Won&apos;t fit your stairs
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Needs 49.9 degrees of tilt and 1,918 mm of headroom at your landing.
            You have 2,140.
          </p>
          <div className="mt-4 flex gap-6">
            <NumberPlate value={1918} unit="mm" source="needed" size="md" />
            <NumberPlate value={2140} unit="mm" source="you measured this" size="md" tone="ok" />
          </div>
          <Button className="mt-6 h-12 w-full" onClick={() => setSheetOpen(false)}>
            Close
          </Button>
        </div>
      </Sheet>
    </AppShell>
  );
}
