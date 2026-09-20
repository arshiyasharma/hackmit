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
 * WHERE IT LIVES. At the bottom center of the room, below the image. The
 * composer stays open and room-derived suggestions stay above it, including
 * after an item has been placed. A suggestion fills the field; the user sends.
 * "/" or Cmd/Ctrl+K focuses the field from elsewhere on the room screen.
 */

import * as React from "react";
import { ArrowUp } from "lucide-react";

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
 * Use the analyzed room's suggestions first, then its room type. Generic
 * furniture suggestions keep the composer useful before the room read arrives.
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
  }).slice(0, 3);
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
  const roomContext = useRoomContext();

  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement | null>(null);

  const empty = text.trim().length === 0;

  /*
   * "asking" means the user is engaged with the field, not merely that it is on
   * screen — an untouched field over an empty room is the `empty` phase, and
   * the room screen should be able to tell the two apart.
   */
  const asking = focused || !empty;

  React.useEffect(() => {
    setAskingFlag(asking);
    return () => setAskingFlag(false);
  }, [asking]);

  const asks = React.useMemo(
    () => roomContext ? buildAsks(roomContext) : ASKS_DEFAULT.slice(0, 3),
    [roomContext]
  );

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

  return (
    <div className="room-composer-input pointer-events-auto w-full">
      <div
        aria-label="Suggested items"
        className="room-composer-suggestions mb-2.5 flex flex-wrap justify-center gap-2"
      >
        {asks.map((ask) => (
          <button
            key={ask}
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              // Choosing a suggestion fills the field without sending it.
              setText(ask);
              fieldRef.current?.focus();
            }}
            className={cn(
              "min-h-9 max-w-full cursor-pointer rounded-none border border-line bg-surface px-3.5 py-2",
              "font-sans text-[13px] leading-tight text-muted-foreground",
              "transition-colors hover:border-accent/30 hover:bg-accent-wash hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            )}
          >
            {ask}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
        className={cn(
          "room-composer-field flex min-h-[60px] items-center gap-3 rounded-none border border-line bg-surface py-2.5 pr-2.5 pl-5",
          "shadow-[0_2px_12px_rgba(0,0,0,0.035)] transition-[border-color,box-shadow]",
          "focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10"
        )}
      >
        <label htmlFor="ask-field" className="sr-only">
          What would you like in your room?
        </label>
        <input
          id="ask-field"
          ref={fieldRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Clear the field first, then release focus on the next Escape.
            event.preventDefault();
            if (text.length > 0) setText("");
            else event.currentTarget.blur();
          }}
          enterKeyHint="send"
          autoComplete="off"
          aria-keyshortcuts="/ Control+K Meta+K"
          placeholder="What would you like in your room?"
          className="min-w-0 flex-1 bg-transparent py-2 font-sans text-base text-foreground caret-accent placeholder:text-muted-foreground focus:outline-none"
        />

        {!focused && empty ? (
          <kbd
            aria-hidden
            className="hidden h-5 min-w-5 shrink-0 place-items-center rounded border border-line px-1 font-sans text-[11px] leading-none text-muted-foreground sm:grid"
          >
            /
          </kbd>
        ) : null}

        <button
          type="submit"
          onPointerDown={(event) => event.preventDefault()}
          aria-label="Add item to your room"
          className={cn(
            "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-none",
            "bg-accent text-white transition-colors hover:bg-accent-bright active:bg-accent-bright",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          )}
        >
          <ArrowUp className="size-[19px]" strokeWidth={2} aria-hidden />
        </button>
      </form>
    </div>
  );
}

export default AskInput;
