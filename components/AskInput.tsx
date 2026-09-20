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
 */

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowUp, Plus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { withDemo } from "@/lib/demo";
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

/** True while the ask field is open. The room screen's "asking" phase. */
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

/* --------------------------------------------------------------- component */

export function AskInput() {
  const items = useStore((s) => s.items);
  const roomContext = useRoomContext();
  const roomImage = useStore((s) => s.roomImage);
  const reduced = useReducedMotion();

  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement | null>(null);

  const hasItems = items.length > 0;
  // the field is the whole screen's job until something is placed; after that
  // it collapses so it stops covering the room
  const expanded = !hasItems || open;

  /*
   * "asking" means the user is engaged with the field, not merely that it is on
   * screen — an untouched field over an empty room is the `empty` phase, and
   * the room screen should be able to tell the two apart.
   */
  const asking = expanded && (focused || text.trim().length > 0);

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
      setOpen(false);

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

  const spring = reduced
    ? ({ duration: 0.15 } as const)
    : ({ type: "spring", stiffness: 420, damping: 34 } as const);

  /* ------------------------------------------------------- collapsed pill */

  if (!expanded) {
    return (
      <div className="pointer-events-auto flex justify-center">
        <motion.button
          type="button"
          layout
          transition={spring}
          onClick={() => {
            setOpen(true);
            window.setTimeout(() => fieldRef.current?.focus(), 60);
          }}
          className={cn(
            "flex min-h-11 items-center gap-1.5 rounded-full px-4",
            "border border-line bg-background/85 text-sm font-medium backdrop-blur-md",
            "shadow-[0_6px_24px_rgb(0_0_0/0.12)] transition-colors active:bg-muted"
          )}
        >
          <Plus className="size-4 text-accent" aria-hidden />
          Add something
        </motion.button>
      </div>
    );
  }

  /* --------------------------------------------------------- the open ask */

  return (
    <motion.div layout transition={spring} className="pointer-events-auto">
      {/* chips generated from this room, not a fixed list */}
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {waitingForContext && asks.length === 0
          ? [0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-28 shrink-0 rounded-full" />
            ))
          : null}

        <AnimatePresence initial={false}>
          {asks.map((ask, i) => (
            <motion.button
              key={ask}
              type="button"
              initial={{ opacity: 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={
                reduced ? { duration: 0.15 } : { ...spring, delay: Math.min(i, 6) * 0.04 }
              }
              // keep the focus in the field: a blur here would collapse the
              // whole ask out from under the finger before the tap landed
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setText(ask);
                fieldRef.current?.focus();
              }}
              className={cn(
                // `tap` puts a 44px hit area around a chip that reads as 32px
                "tap min-h-8 shrink-0 rounded-full border border-line px-3 py-1.5",
                "bg-background/80 text-[13px] whitespace-nowrap backdrop-blur-md",
                "transition-colors active:bg-muted"
              )}
            >
              {ask}
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className={cn(
          "flex items-center gap-2 rounded-full border border-line",
          "bg-background/90 py-1.5 pr-1.5 pl-4 backdrop-blur-md",
          "shadow-[0_6px_24px_rgb(0_0_0/0.12)]"
        )}
      >
        <label htmlFor="ask-field" className="sr-only">
          What does this room need?
        </label>
        <input
          id="ask-field"
          ref={fieldRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // a blur on a phone means the keyboard went away; the field only
            // collapses once something is standing in the room
            if (hasItems && text.trim() === "") setOpen(false);
          }}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="a tall lamp"
          className={cn(
            "font-display min-w-0 flex-1 bg-transparent text-lg",
            "placeholder:text-muted-foreground/70 focus:outline-none"
          )}
        />
        <button
          type="submit"
          onPointerDown={(e) => e.preventDefault()}
          aria-label="Ask for this"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            "bg-accent text-[color:var(--on-accent)] transition-transform",
            "active:translate-y-px"
          )}
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      </form>
    </motion.div>
  );
}

export default AskInput;
