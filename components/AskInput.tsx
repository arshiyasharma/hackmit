"use client";

/**
 * THE ASK. One object at a time, in plain words.
 *
 * It takes no props and reads the store, like every overlay on the room
 * screen. It is also where the loop starts, so the orchestration lives here:
 *
 *   1. submit -> addItem() SYNCHRONOUSLY. The PlacedItem exists, it is active,
 *      and the skeleton is on screen before any network call has returned.
 *      This is the 100ms criterion and it is the reason the order is this way
 *      round rather than "ask the server what this is, then make the item".
 *   2. THEN the jobs go out in parallel, none of them blocking the others:
 *        /api/normalise   the category the other two key off  (here)
 *        /api/placeholder the stand-in sprite                 (here)
 *        /api/search      the real listings   (OptionSheet, off the same item)
 *      Each fills its own part of the item as it lands. A failure marks that
 *      part failed and the rest of the screen carries on.
 *
 * An empty submit is a valid submit: the room type chooses an object. The demo
 * must never dead-end on a blank field.
 *
 * WHERE IT LIVES. At the foot of the agent panel (app/room/page.tsx), as the
 * composer of the conversation above it. On a phone it used to fold into a
 * "+ Add something" button so it stopped covering the room; in the panel it
 * covers nothing, so THE FIELD STAYS OPEN — a laptop expects a composer it can
 * reach with a key ("/" or Cmd/Ctrl+K), not one it has to unfold first. What
 * still folds once something is placed is the row of suggestions, which would
 * otherwise eat the conversation's height: it comes back the moment the field
 * is engaged, and "Add something" is the label of the folded state.
 */

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowUp, Plus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { withDemo } from "@/lib/demo";
import { DUR, ENTER, EXIT, REDUCED, STAGGER } from "@/lib/motion";
import { roomContextFor, useRoomContext, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { RoomContext } from "@/types";

/* ------------------------------------------------------- the asking flag */

/*
 * The room screen's state machine needs to know when the user is mid-ask, and
 * that is a fact about this input rather than about the store. It lives in a
 * two-line external store so app/room/page.tsx can read it without this
 * component taking a prop or the shared store growing a UI field.
 */

let askingNow = false;
const askingListeners = new Set<() => void>();

function setAskingFlag(next: boolean) {
  if (askingNow === next) return;
  askingNow = next;
  for (const listener of askingListeners) listener();
}

function subscribeAsking(listener: () => void): () => void {
  askingListeners.add(listener);
  return () => {
    askingListeners.delete(listener);
  };
}

/**
 * Ask for something from anywhere on the screen.
 *
 * The budget sheet suggests "a floor rug" and a tap has to start the same loop
 * a typed ask starts — so it goes through the same module-level channel the
 * field itself listens on, rather than a second copy of the submit logic.
 */
const pendingAsks = new Set<(request: string) => void>();

export function askFor(request: string): void {
  for (const listener of pendingAsks) listener(request);
}

/** True while the ask field is engaged. The room screen's "asking" phase. */
export function useAsking(): boolean {
  return React.useSyncExternalStore(
    subscribeAsking,
    () => askingNow,
    () => false
  );
}

/* ------------------------------------------------------------ suggestions */

/**
 * Chips come from THIS room, never a hardcoded list. /api/analyze may hand us
 * ask-chip seeds directly; if it only gives us a room type and a lighting
 * word, we build the asks out of those.
 */
const ASKS_BY_ROOM: Array<readonly [string, string[]]> = [
  ["bedroom", ["a table lamp", "a floor rug", "a mirror", "a side table"]],
  ["dining", ["a dining chair", "a pendant light", "a framed picture", "an area rug"]],
  ["kitchen", ["a bar stool", "a pendant light", "a wall shelf"]],
  ["office", ["a desk chair", "a table lamp", "a bookshelf", "a framed picture"]],
  ["study", ["a bookshelf", "a desk chair", "a tall lamp"]],
  ["hall", ["a mirror", "a runner rug", "a framed picture", "a side table"]],
  ["entry", ["a mirror", "a runner rug", "a stool"]],
  ["nursery", ["an area rug", "a table lamp", "a bookshelf"]],
];

const ASKS_DEFAULT = ["a tall lamp", "a floor rug", "a framed picture", "a side table"];

export function buildAsks(context: RoomContext | null): string[] {
  if (!context) return [];

  const given = (context.suggestions ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 28);

  const roomType = (context.roomType ?? "").toLowerCase();
  const byRoom =
    ASKS_BY_ROOM.find(([fragment]) => roomType.includes(fragment))?.[1] ??
    ASKS_DEFAULT;

  const asks = [...given, ...byRoom];

  // A room the model called cool or dim wants light first. The chip order is
  // the only opinion we have room for here, so it may as well be a useful one.
  if (context.lighting !== "warm") {
    asks.sort((a, b) => Number(b.includes("lamp")) - Number(a.includes("lamp")));
  }

  const seen = new Set<string>();
  return asks.filter((ask) => {
    const key = ask.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

/* ----------------------------------------------------------------- jobs */

type NormaliseAnswer = {
  request?: string;
  category?: string;
  silhouette?: string | null;
  matched?: boolean;
  defaulted?: boolean;
};

/**
 * The normalised category arrives after the item does, and the store has no
 * action for "this item turned out to be a floor lamp" — so the one field is
 * patched through the store's own setState. Everything else goes through an
 * action. See followups: lib/store.ts wants a `setCategory(id, category)`.
 */
function setItemCategory(id: string, category: string) {
  if (!category) return;
  useStore.setState((s) => ({
    items: s.items.map((item) =>
      item.id === id && item.category !== category ? { ...item, category } : item
    ),
  }));
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(withDemo(url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // offline, route missing, venue wifi — the caller degrades, it never throws
    return null;
  }
}

/* ------------------------------------------------------------- shortcuts */

/** Is the keyboard already talking to some other field? Then leave it alone. */
function typingElsewhere(field: HTMLInputElement | null): boolean {
  const el = document.activeElement;
  if (!el || el === field || el === document.body) return false;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return true;
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * A modal dialog owns the keyboard while it is up. The landing keeps its own
 * hidden dialogs in the DOM behind room III (inside `.sense`); those do not
 * count.
 */
function modalOpen(): boolean {
  const found = document.querySelectorAll("[role='dialog'][aria-modal='true']");
  return Array.from(found).some((el) => !el.closest(".sense"));
}

/* --------------------------------------------------------------- component */

export function AskInput() {
  const items = useStore((s) => s.items);
  const roomContext = useRoomContext();
  const roomImage = useStore((s) => s.roomImage);
  const reduced = useReducedMotion();

  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement | null>(null);

  const hasItems = items.length > 0;
  const empty = text.trim().length === 0;

  /*
   * "asking" means the user is engaged with the field, not merely that it is on
   * screen — an untouched field over an empty room is the `empty` phase, and
   * the room screen should be able to tell the two apart.
   */
  const asking = focused || !empty;

  // the suggestions are the whole panel's job until something is placed; after
  // that they fold away, and come back while the field is engaged
  const showChips = !hasItems || asking;

  React.useEffect(() => {
    setAskingFlag(asking);
    return () => setAskingFlag(false);
  }, [asking]);

  const asks = React.useMemo(() => buildAsks(roomContext), [roomContext]);
  const waitingForContext = roomContext === null && roomImage !== null;

  const submit = React.useCallback(
    (raw: string) => {
      const store = useStore.getState();
      // the edited context: the placeholder prompt and the search both key
      // off this, so a word or colour changed above is in from the first call
      const context = roomContextFor(store);

      // an empty ask is valid: the room chooses. Never dead-end.
      const request =
        raw.trim() ||
        buildAsks(context)[0] ||
        "a floor lamp";

      /* ---- 1. the item exists NOW, before anything goes out over the wire */
      const id = store.addItem({ request, category: request });

      setText("");
      // ONE THING AT A TIME: the words are sent, so the field lets go of the
      // keyboard and the screen's phase moves on from "asking" to the wait.
      // "/" brings it straight back.
      fieldRef.current?.blur();

      /* ---- 2. three calls, in parallel, each filling its own part */
      const payloadContext = context ?? null;

      void postJson<NormaliseAnswer>("/api/normalise", {
        request,
        roomType: payloadContext?.roomType ?? null,
      }).then((answer) => {
        if (answer?.category) setItemCategory(id, answer.category);
      });

      void postJson<{ url?: string; widthRatio?: number }>("/api/placeholder", {
        category: request,
        request,
        roomContext: payloadContext,
      }).then((answer) => {
        const patch = useStore.getState().setPlaceholder;
        if (answer?.url) patch(id, { url: answer.url, widthRatio: answer.widthRatio });
        else patch(id, null);
      });

      /*
       * The third job — /api/search — is fired by components/OptionSheet.tsx
       * the moment an item with `optionsStatus: "pending"` becomes active,
       * which is now. It de-duplicates per item id in its own module, so
       * calling it from here as well would send every search twice and let two
       * answers race into setOptions. The two jobs still run in parallel; this
       * one is simply owned next door.
       */
    },
    []
  );

  /* a suggestion tapped elsewhere on the screen submits exactly like a type */
  React.useEffect(() => {
    pendingAsks.add(submit);
    return () => {
      pendingAsks.delete(submit);
    };
  }, [submit]);

  /*
   * "/" OR CMD/CTRL+K PUTS THE CURSOR IN THE ASK, from anywhere on the screen.
   * It never takes a key away from another field (the budget, a style word, a
   * hex code) and never reaches out of a modal dialog.
   */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const slash =
        event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const commandK =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";
      if (!slash && !commandK) return;

      const field = fieldRef.current;
      if (!field || document.activeElement === field) return;
      if (typingElsewhere(field) || modalOpen()) return;

      event.preventDefault();
      field.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const arrive = reduced ? REDUCED : ENTER;
  const leave = reduced ? REDUCED : EXIT;

  // the motion sheet's caret: a 2px accent bar, blinking there-and-back, only
  // while the field is focused and still empty. With words in it the browser's
  // own caret takes over, because only the browser knows where it is.
  const showCaret = focused && text.length === 0;

  // every `duration-[240ms]` below is DUR.micro, said in CSS
  return (
    // `relative`: the row that is leaving is lifted out of the flow against
    // this box, so the foot of the panel changes height once, not twice
    <div className="pointer-events-auto relative">
      {/* ------------------------------------------- above the pill: chips */}
      <AnimatePresence initial={false} mode="popLayout">
        {showChips ? (
          <motion.div
            key="chips"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: arrive }}
            exit={{ opacity: 0, transition: leave }}
            // chips generated from this room, not a fixed list; they wrap
            // inside the panel rather than scrolling sideways under a mouse
            className="mb-3 flex flex-wrap gap-x-1.5 gap-y-2 empty:hidden"
          >
            {waitingForContext && asks.length === 0
              ? [0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />
                ))
              : null}

            {asks.map((ask, i) => (
              <motion.button
                key={ask}
                type="button"
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced
                    ? REDUCED
                    : { ...ENTER, delay: Math.min(i, 6) * STAGGER.chip }
                }
                // keep the focus in the field: a blur here would fold the
                // suggestions away from under the pointer before the click landed
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  // a chip only fills the field; sending is still the user's call
                  setText(ask);
                  fieldRef.current?.focus();
                }}
                className={cn(
                  // `tap` puts a 44px hit area around a chip that reads as 36px
                  "glass-pill tap min-h-9 shrink-0 cursor-pointer px-3.5 py-1.5",
                  "text-[14px] leading-tight whitespace-nowrap text-foreground",
                  "transition-colors duration-[240ms]",
                  "hover:text-accent hover:[background:var(--accent-wash)]",
                  "active:[background:var(--accent-pale)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                )}
              >
                {ask}
              </motion.button>
            ))}
          </motion.div>
        ) : (
          /* the folded state: something is standing in the room, and the ask
             is waiting for the next thing */
          <motion.button
            key="add"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: arrive }}
            exit={{ opacity: 0, transition: leave }}
            onClick={() => fieldRef.current?.focus()}
            className={cn(
              "eyebrow tap mb-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-full",
              "text-muted-foreground transition-colors duration-[240ms] hover:text-accent",
              "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            )}
          >
            <Plus className="size-3.5 text-accent" aria-hidden />
            Add something
          </motion.button>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------- the pill */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className={cn(
          "glass-pill flex items-center gap-2 py-1.5 pr-1.5 pl-5",
          // the ring is an outline, so it never fights the glass's own shadow
          "outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-[240ms]",
          "focus-within:outline-accent"
        )}
      >
        <label htmlFor="ask-field" className="sr-only">
          What does this room need?
        </label>

        <span className="relative flex min-w-0 flex-1 items-center">
          {showCaret ? (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 h-[1.3em] w-0.5 -translate-y-1/2 rounded-full bg-accent text-base"
              initial={{ opacity: 1 }}
              animate={reduced ? { opacity: 1 } : { opacity: [1, 0] }}
              transition={
                reduced
                  ? REDUCED
                  : {
                      duration: DUR.element,
                      ease: "linear",
                      repeat: Infinity,
                      repeatType: "reverse",
                    }
              }
            />
          ) : null}
          <input
            id="ask-field"
            ref={fieldRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              // Escape belongs to the field first: clear the words, then let
              // go. Marked handled, so the host does not also read it as
              // "leave the room".
              e.preventDefault();
              if (text.length > 0) setText("");
              else e.currentTarget.blur();
            }}
            enterKeyHint="send"
            autoComplete="off"
            aria-keyshortcuts="/ Control+K Meta+K"
            placeholder="a tall lamp"
            className={cn(
              // 16px and up: legible at arm's length, and no zoom-on-focus
              "min-w-0 flex-1 bg-transparent py-2 pl-1.5 font-sans text-base text-foreground",
              "placeholder:text-muted-foreground focus:outline-none",
              showCaret ? "caret-transparent" : "caret-accent"
            )}
          />
        </span>

        {/* the way in from the keyboard, said once, where the eye already is */}
        {!focused && empty ? (
          <kbd
            aria-hidden
            className={cn(
              "grid h-6 min-w-6 shrink-0 place-items-center rounded-md border border-line bg-surface/70 px-1.5",
              "font-mono text-[11px] leading-none text-muted-foreground"
            )}
          >
            /
          </kbd>
        ) : null}

        <button
          type="submit"
          onPointerDown={(e) => e.preventDefault()}
          aria-label="Ask for this"
          className={cn(
            // solid, not glass: it already sits on a glass pill on a glass panel
            "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full",
            "bg-accent text-[color:var(--on-accent)] transition-transform duration-[240ms]",
            "hover:-translate-y-px active:translate-y-px",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      </form>

      {/* the promise, under the pill, until the first thing has been asked for */}
      <AnimatePresence initial={false}>
        {!hasItems ? (
          <motion.p
            key="promise"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: arrive }}
            exit={{ opacity: 0, transition: leave }}
            className="eyebrow mt-3 text-center text-muted-foreground"
          >
            NO CATALOGUE. NO FILTERS. NO FLOOR PLAN.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default AskInput;
