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
 * button asks once before it hands over: here is what is left, here are four
 * things this room could still use, tap one and the loop starts again.
 *
 * THE SUGGESTIONS COME FROM THE ROOM, not from a list. `roomContext.suggestions`
 * is what the model answered when it read the photo — "a floor rug", "a framed
 * picture" — so they match the room a judge is looking at rather than a
 * hardcoded set that matches nothing.
 *
 * NOTHING IS FETCHED UNTIL A CHIP IS TAPPED. Pre-loading example listings for
 * four suggestions would be four searches nobody asked for, every time anyone
 * reaches checkout. A tap is one search, for the one thing they chose.
 */

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
    >
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-xl">
            {money(leftCents)} still to spend
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {suggestions.length
              ? "This room could also use one of these — or check out as you are."
              : "Add anything else you want, or check out as you are."}
          </p>
        </div>

        {suggestions.length ? (
          <ul className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    askFor(suggestion);
                  }}
                  className={cn(
                    "tap flex min-h-12 w-full items-center justify-between gap-3",
                    "rounded-2xl border border-line bg-background px-4 text-left text-sm",
                    "transition-colors hover:bg-muted active:bg-muted"
                  )}
                >
                  <span className="truncate capitalize">{suggestion}</span>
                  <ArrowRight className="size-4 shrink-0 text-accent" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className={cn(
              "tap min-h-12 flex-1 rounded-full bg-accent px-5 text-sm",
              "text-[color:var(--on-accent)]"
            )}
          >
            Check out anyway
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="tap min-h-12 rounded-full border border-line px-4 text-sm"
          >
            Keep shopping
          </button>
        </div>
      </div>
    </Sheet>
  );
}
