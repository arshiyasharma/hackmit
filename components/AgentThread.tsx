"use client";

/**
 * THE CONVERSATION — the body of the agent panel on the room screen.
 *
 * The ask, the wait and the answer are one exchange, in glass: the shopper's
 * words on the right in the accent, PIXX-AR's on the left on paper. One short
 * exchange per thing asked for, in the order they were asked, newest at the
 * bottom.
 *
 * IT NEVER INVENTS AN EVENT. There is no message log anywhere: every line here
 * is read off the store at render time — the item's request, its two job
 * statuses, how many listings came back, the listing that is linked, and the
 * fit kernel's own sentence. If the store did not cause it, it is not said. A
 * number the backend did not give is a dash, or is not there.
 *
 * What PIXX-AR says about one item, by state:
 *   searching   the wait, in the user's own words (never a spinner)
 *   ready       "5 real listings. Hover one — your floor lamp tries it on."
 *   none        what the tray says when nothing came back
 *   failed      what the tray says when the shops did not answer
 *   linked      the listing's name, price, height and where that height came
 *               from, and the fit verdict's reason VERBATIM
 *
 * An exchange is also the way back into an item: click it (or press Enter on
 * the shopper's bubble) and that item becomes the active one and its listings
 * come up — the same thing a chip in the items strip does.
 *
 * GLASS BUDGET. The panel this lives in is already thick glass, so the
 * shopper's bubble is the second layer and PIXX-AR's bubble is solid paper
 * with a hairline. Nothing here is glass on glass on glass.
 *
 * Takes no props. Reads the store, like every other overlay on the room screen.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { openOptionsFor } from "@/components/OptionSheet";
import { formatPrice } from "@/components/ProductCard";
import { StatusLine } from "@/components/ui/StatusLine";
import { ENTER, EXIT, REDUCED, STAGGER } from "@/lib/motion";
import { searchQuery, useRoomContext, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem, Product, RoomContext } from "@/types";

/* ------------------------------------------------------------------ words */

/** Said once, before anything has been asked for. */
const INTRO =
  "Ask for one thing. I'll stand it in your room at its real size and find real listings for it.";

/**
 * The tray's own words for its two empty states (components/SourcingResults.tsx,
 * NoMatch), so the conversation and the tray never tell two different stories.
 */
const NOTHING_BACK = "Nothing came back for that.";
const NOTHING_BACK_NEXT =
  "Try it again, or drop a style word from the strip at the top to widen the search.";
const SHOPS_SILENT = "The shops didn't answer.";
const SHOPS_SILENT_NEXT =
  "Try the search again, or take the words straight to a shop.";

/** "floor lamp" -> "a floor lamp"; "armchair" -> "an armchair". */
function article(category: string): string {
  const word = category.trim();
  if (!word) return "a stand-in";
  if (/^(?:a|an|the)\s/i.test(word)) return word;
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/** "a tall lamp" -> "tall lamp", for "your tall lamp tries it on". */
function bare(text: string): string {
  return text.trim().replace(/^(?:a|an|the)\s+/i, "");
}

const SKETCHING = (item: PlacedItem) =>
  `Sketching ${article(item.category)} in your room's colours…`;

/** What the wait is called, in the user's own words rather than a spinner. */
function waitMessages(item: PlacedItem, context: RoomContext | null): string[] {
  const out: string[] = [];
  if (item.placeholderStatus === "pending") out.push(SKETCHING(item));
  if (item.optionsStatus === "pending") {
    // the query that will actually run, edits from the strip included
    const query = searchQuery(context, item.request);
    out.push(`Searching for ${query || item.request}…`);
    out.push("Reading dimensions off the listings…");
  }
  return out;
}

/** Which of its five lines PIXX-AR is on for this item. */
type Line = "searching" | "ready" | "none" | "failed" | "linked";

function lineOf(item: PlacedItem): Line {
  // a linked listing is the most that can be said, whatever else is in flight
  if (item.linkedProduct) return "linked";
  if (item.optionsStatus === "pending") return "searching";
  if (item.optionsStatus === "failed") return "failed";
  return item.options.length > 0 ? "ready" : "none";
}

/* ------------------------------------------------------------- the pieces */

/** every `duration-[240ms]` below is DUR.micro, said in CSS */
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** A figure: mono and tabular, so it never reflows the sentence around it. */
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="tabular font-mono">{children}</span>;
}

/**
 * The linked listing, as PIXX-AR reports it: what it is called, what it costs,
 * how tall it is and WHO SAYS SO. A quoted height names the shop; a guessed one
 * says "estimated" (or "approx") in the warn colour; a missing one says so and
 * is never filled in.
 */
function LinkedLine({ item, product }: { item: PlacedItem; product: Product }) {
  const listed = product.dimsSource !== "missing" ? product.dimsMm?.[1] : undefined;
  const height = typeof listed === "number" && listed > 0 ? listed : null;
  const quoted = product.dimsSource === "quoted";
  const fit = item.fit;

  return (
    <div className="flex flex-col gap-1.5">
      {/* a name, so it may be set in the display face: 20px, weight 500 */}
      <p className="line-clamp-2 font-display text-[21px] leading-[1.08] font-medium tracking-[0.01em] text-foreground">
        {product.title}
      </p>

      <p className="font-mono text-[12px] leading-snug text-muted-foreground">
        {/* the same money the cards print; a listing with no price gets a dash */}
        <span className="tabular text-[13px] font-medium text-foreground">
          {product.priceCents > 0
            ? formatPrice(product.priceCents, product.currency || "USD")
            : "—"}
        </span>
        {" · "}
        {product.retailer}
      </p>

      <p className="font-mono text-[12px] leading-snug text-muted-foreground">
        {height !== null ? (
          <>
            <span className="tabular text-foreground">
              {height.toLocaleString("en-US")} mm
            </span>{" "}
            tall{" — "}
            {quoted ? (
              `from the ${product.retailer} listing`
            ) : (
              <span className="font-sans font-medium text-warn">
                {product.dimsSource === "approx" ? "approx" : "estimated"}
              </span>
            )}
          </>
        ) : (
          "No size on the listing"
        )}
      </p>

      {fit ? (
        <p
          className={cn(
            "text-[14px] leading-snug",
            fit.verdict === "pass" ? "text-ok" : "font-medium text-warn"
          )}
        >
          {/* the kernel's own sentence, not a word of it rewritten */}
          {fit.reason}
        </p>
      ) : null}
    </div>
  );
}

/** PIXX-AR's side of one exchange. */
function AgentLine({
  item,
  context,
}: {
  item: PlacedItem;
  context: RoomContext | null;
}) {
  const line = lineOf(item);

  if (line === "searching") {
    return (
      <StatusLine
        messages={waitMessages(item, context)}
        intervalMs={2400}
        className="text-[15px] leading-snug text-foreground"
      />
    );
  }

  // the listings can land minutes before the drawing does; say both
  const stillSketching =
    item.placeholderStatus === "pending" ? (
      <StatusLine
        messages={[SKETCHING(item)]}
        className="mt-1.5 min-h-0 text-[13px] leading-snug text-muted-foreground"
      />
    ) : null;

  if (line === "linked" && item.linkedProduct) {
    return (
      <>
        <LinkedLine item={item} product={item.linkedProduct} />
        {stillSketching}
      </>
    );
  }

  if (line === "ready") {
    const count = item.options.length;
    const thing = bare(item.category || item.request) || "stand-in";
    return (
      <>
        <p className="text-[15px] leading-snug text-foreground">
          <Figure>{count}</Figure> real listing{count === 1 ? "" : "s"}. Hover{" "}
          {count === 1 ? "it" : "one"} — your {thing} tries it on.
        </p>
        {stillSketching}
      </>
    );
  }

  const failed = line === "failed";
  return (
    <>
      <p className="text-[15px] leading-snug text-foreground">
        <span className={cn("font-medium", failed && "text-warn")}>
          {failed ? SHOPS_SILENT : NOTHING_BACK}
        </span>{" "}
        <span className="text-muted-foreground">
          {failed ? SHOPS_SILENT_NEXT : NOTHING_BACK_NEXT}
        </span>
      </p>
      {stillSketching}
    </>
  );
}

/** Who is speaking. */
function Speaker({ active }: { active: boolean }) {
  return (
    <p
      className={cn(
        "eyebrow mb-1.5 transition-colors duration-[240ms]",
        active ? "text-accent" : "text-muted-foreground"
      )}
    >
      PIXX-AR
    </p>
  );
}

/* -------------------------------------------------------------- component */

export function AgentThread() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const setActiveItem = useStore((s) => s.setActiveItem);
  // edits included, so the wait names the query that will actually run
  const roomContext = useRoomContext();
  const reduced = useReducedMotion();

  const scroller = React.useRef<HTMLDivElement | null>(null);
  const content = React.useRef<HTMLDivElement | null>(null);

  /*
   * NEWEST AT THE BOTTOM, AND IT STAYS THERE — unless the user has scrolled up
   * to read something, in which case the thread leaves them where they are. A
   * bubble changes height whenever its line changes (a wait becomes a listing,
   * a verdict lands), so this follows the content's size rather than a list of
   * things that might have changed it.
   */
  const pinned = React.useRef(true);

  React.useEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!box || !inner || typeof ResizeObserver === "undefined") return;
    const toEnd = () => {
      if (pinned.current) box.scrollTop = box.scrollHeight;
    };
    const observer = new ResizeObserver(toEnd);
    observer.observe(inner);
    observer.observe(box);
    toEnd();
    return () => observer.disconnect();
  }, []);

  /* a new ask is the user talking: the thread goes back to the bottom for it */
  const count = items.length;
  const lastCount = React.useRef(count);
  React.useEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (!grew) return;
    pinned.current = true;
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count]);

  /*
   * An item made active from somewhere else — a chip, the thing standing in the
   * room — is brought into view here too. Moved by hand inside this box rather
   * than with scrollIntoView, which is free to scroll the page behind it.
   */
  React.useEffect(() => {
    const box = scroller.current;
    if (!box || !activeItemId) return;
    const node = Array.from(
      box.querySelectorAll<HTMLElement>("[data-item-id]")
    ).find((el) => el.dataset.itemId === activeItemId);
    if (!node) return;
    const frame = box.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (rect.top < frame.top) box.scrollTop -= frame.top - rect.top + 12;
    else if (rect.bottom > frame.bottom) box.scrollTop += rect.bottom - frame.bottom + 12;
  }, [activeItemId]);

  const open = (id: string) => {
    // makes it active AND brings its listings up — the same way in as a chip
    // in the items strip
    setActiveItem(id);
    openOptionsFor(id);
  };

  const arrive = (order: number) =>
    reduced ? REDUCED : { ...ENTER, delay: order * STAGGER.chip };
  const from = reduced ? { opacity: 0 } : { opacity: 0, y: 8 };
  const to = (order: number) => ({ opacity: 1, y: 0, transition: arrive(order) });
  const gone = { opacity: 0, transition: reduced ? REDUCED : EXIT };

  return (
    <div
      ref={scroller}
      role="log"
      aria-label="Conversation with PIXX-AR"
      onScroll={(event) => {
        const box = event.currentTarget;
        pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
      }}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4",
        "[scrollbar-width:thin] [scrollbar-color:var(--accent-pale)_transparent]",
        // the top and bottom of the scroll soften into the panel, not a hard cut
        "[mask-image:linear-gradient(to_bottom,transparent,#000_14px,#000_calc(100%_-_14px),transparent)]"
      )}
    >
      {/* `relative`: the intro is lifted out of the flow against this box as it
          leaves, so the first exchange lands where it will stay */}
      <div
        ref={content}
        className="relative flex min-h-full flex-col justify-end gap-5 py-4"
      >
        {/* before anything is asked: one quiet line, in PIXX-AR's voice */}
        <AnimatePresence mode="popLayout">
          {items.length === 0 ? (
            <motion.div
              key="intro"
              initial={from}
              animate={to(0)}
              exit={gone}
              aria-live="polite"
              className="max-w-[92%] self-start rounded-[22px] rounded-bl-lg border border-line bg-surface/80 px-4 py-3"
            >
              <Speaker active />
              <p className="text-[15px] leading-snug text-foreground">{INTRO}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* `initial={false}`: a thread that mounts with a room already in it
            (back from checkout) is simply there; only what is asked for from
            now on arrives */}
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const active = item.id === activeItemId;
            return (
              <motion.div
                key={item.id}
                data-item-id={item.id}
                exit={gone}
                onClick={() => open(item.id)}
                className="group/exchange flex cursor-pointer flex-col gap-2"
              >
                {/* the shopper: their exact words, and the keyboard's way in */}
                <motion.button
                  type="button"
                  initial={from}
                  animate={to(0)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "glass-blue max-w-[85%] cursor-pointer self-end !rounded-br-lg px-4 py-2.5 text-left",
                    "text-[15px] leading-snug break-words",
                    "transition-[translate] duration-[240ms] hover:-translate-y-px",
                    FOCUS
                  )}
                >
                  <span className="sr-only">You asked for </span>
                  {item.request}
                  <span className="sr-only">. Show its listings.</span>
                </motion.button>

                {/* PIXX-AR: solid paper with a hairline; the active item's
                    answer is the one drawn in the accent */}
                <motion.div
                  initial={from}
                  animate={to(1)}
                  aria-live="polite"
                  className={cn(
                    "max-w-[92%] self-start rounded-[22px] rounded-bl-lg border px-4 py-3",
                    "transition-colors duration-[240ms]",
                    active
                      ? "border-accent/50 bg-surface"
                      : "border-line bg-surface/80 group-hover/exchange:border-accent-pale group-hover/exchange:bg-surface"
                  )}
                >
                  <Speaker active={active} />
                  {/* re-keyed, so a line that becomes a different line (the
                      wait lands, another listing is linked) fades in afresh */}
                  <motion.div
                    key={`${lineOf(item)}:${item.linkedProduct?.id ?? ""}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: reduced ? REDUCED : ENTER }}
                  >
                    <AgentLine item={item} context={roomContext} />
                  </motion.div>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default AgentThread;
