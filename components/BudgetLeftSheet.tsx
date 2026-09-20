"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";

import { money } from "@/components/BudgetHud";
import { Sheet } from "@/components/ui/Sheet";
import { askFor } from "@/components/AskInput";
import { spentCents, useRoomContext, useStore } from "@/lib/store";
import { productTermFromSuggestion } from "@/lib/sourcing/roomContext";
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
    () => new Set(items.map((i) => productTermFromSuggestion(i.request) || i.request.toLowerCase().trim())),
    [items]
  );

  const suggestions = React.useMemo(() => {
    const fromRoom = (roomContext?.suggestions ?? []).map(productTermFromSuggestion).filter(Boolean);
    return [...new Set(fromRoom)].filter((suggestion) => !asked.has(suggestion)).slice(0, 4);
  }, [roomContext, asked]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[0.5]}
      initialSnap={0}
      label="You have budget left"
      // a question with two answers, not a page: narrower than the default dialog
      className="max-w-[30rem]!"
    >
      <div className="flex flex-col gap-5 font-sans">
        <div>
          <p className="text-[11px] font-medium text-accent">Before you review</p>
          <h2 className="mt-2 text-[26px] font-medium leading-tight tracking-[-0.03em]">
            <span className="tabular-nums">{money(leftCents)}</span> left in your budget
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {suggestions.length
              ? "Add another piece, or continue with the items you’ve chosen."
              : "You can add another piece or review the items you’ve chosen."}
          </p>
        </div>

        {suggestions.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    askFor(suggestion);
                  }}
                  className={cn(
                    "group flex min-h-11 w-full cursor-pointer items-center justify-between gap-3",
                    "rounded-none border border-line bg-white/55 px-3 py-2 text-left text-[13px]",
                    "transition-colors hover:border-accent hover:bg-accent-wash active:bg-accent-wash",
                    FOCUS_RING
                  )}
                >
                  <span className="min-w-0 capitalize">{suggestion}</span>
                  <ArrowRight
                    className="size-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onContinue}
            className={cn(
              "min-h-11 flex-1 cursor-pointer rounded-none border border-accent bg-accent px-4 text-[13px] font-medium text-white",
              "whitespace-nowrap transition-colors hover:bg-accent-bright",
              FOCUS_RING
            )}
          >
            Continue to review
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "min-h-11 cursor-pointer rounded-none border border-line bg-white/55 px-4 text-[13px]",
              "whitespace-nowrap transition-colors hover:border-foreground/30 hover:bg-white/85",
              FOCUS_RING
            )}
          >
            Keep designing
          </button>
        </div>
      </div>
    </Sheet>
  );
}
