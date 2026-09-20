"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { money } from "@/components/BudgetHud";
import { Sheet } from "@/components/ui/Sheet";
import { askFor } from "@/components/AskInput";
import { spentCents, useRoomContext, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * "You are $272 under. Want anything else?"
 *
 * Checkout is the end of the loop, and a budget with room left in it at that
 * moment is the one moment the product can usefully say something. So the
 * button asks once before it hands over: here is what is still to go, here are
 * four things this room could still use, pick one and the loop starts again.
 *
 * It goes through the shared Sheet, so on a laptop it is a centred glass
 * dialog — focus moved in and restored, Escape and the backdrop close it — and
 * the suggestions sit two across. The glass is the Sheet's; nothing in here
 * adds a second pane except the one blue button.
 *
 * THE SUGGESTIONS COME FROM THE ROOM, not from a list. `roomContext.suggestions`
 * is what the model answered when it read the photo — "a floor rug", "a framed
 * picture" — so they match the room a judge is looking at rather than a
 * hardcoded set that matches nothing.
 *
 * NOTHING IS FETCHED UNTIL ONE IS CHOSEN. Pre-loading example listings for
 * four suggestions would be four searches nobody asked for, every time anyone
 * reaches checkout. A click is one search, for the one thing they chose.
 */

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function BudgetLeftSheet({
  open,
  onOpenChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onContinue: () => void;
}) {
  const items = useStore((s) => s.items);
  const budgetCents = useStore((s) => s.budgetCents);
  const roomContext = useRoomContext();

  const leftCents = budgetCents - spentCents(items);

  const asked = React.useMemo(
    () => new Set(items.map((i) => i.request.toLowerCase().trim())),
    [items]
  );

  const suggestions = React.useMemo(() => {
    const fromRoom = roomContext?.suggestions ?? [];
    return fromRoom.filter((s) => !asked.has(s.toLowerCase().trim())).slice(0, 4);
  }, [roomContext, asked]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[0.5]}
      initialSnap={0}
      label="You have budget left"
      // a question with two answers, not a page: narrower than the default dialog
      className="desk:max-w-[38rem]"
    >
      <div className="flex flex-col gap-6">
        <div>
          <p className="eyebrow text-accent">Before you check out</p>
          {/* the figure is mono like every figure; the words are the headline */}
          <h2 className="mt-3 flex flex-wrap items-baseline gap-x-3 font-display text-[40px] leading-none font-normal tracking-[0.01em] desk:text-[48px]">
            <span className="tabular font-mono text-[0.8em] tracking-normal">
              {money(leftCents)}
            </span>{" "}
            to go
          </h2>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            {suggestions.length
              ? "One of these would finish the room — or check out as you are."
              : "Add anything else you want, or check out as you are."}
          </p>
        </div>

        {suggestions.length ? (
          <ul className="grid gap-2.5 desk:grid-cols-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    askFor(suggestion);
                  }}
                  className={cn(
                    "group tap flex min-h-12 w-full cursor-pointer items-center justify-between gap-3",
                    "rounded-2xl border border-line bg-surface/70 px-4 text-left text-[15px]",
                    "transition-colors hover:border-accent hover:bg-accent-wash active:bg-accent-wash",
                    FOCUS_RING
                  )}
                >
                  <span className="truncate capitalize">{suggestion}</span>
                  <ArrowRight
                    className="size-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onContinue}
            className={cn(
              "glass-blue tap min-h-12 flex-1 cursor-pointer rounded-full! px-6 text-sm font-medium",
              "whitespace-nowrap transition-transform hover:-translate-y-px active:translate-y-px",
              FOCUS_RING
            )}
          >
            Check out anyway
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "tap min-h-12 cursor-pointer rounded-full border border-line bg-surface/70 px-5 text-sm",
              "whitespace-nowrap transition-colors hover:border-foreground/30 hover:bg-surface",
              FOCUS_RING
            )}
          >
            Keep shopping
          </button>
        </div>
      </div>
    </Sheet>
  );
}
