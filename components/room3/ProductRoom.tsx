"use client";

/**
 * Room III — the product, in the landing's own room.
 *
 * The landing flies the shopper into the third room and hands the screen over.
 * What opens is the real app: sign in, photograph the room, ask for one thing,
 * see it at size, pick a listing, watch the number, check the stairwell, and
 * let the agent buy it at every shop. Nothing in here is a demo of the product.
 *
 * ONE URL, THREE SCREENS. The screens are the very components the standalone
 * routes render (`/`, `/room`, `/checkout` — the page files themselves, so there
 * is one implementation and not two); they navigate through `useAppNav`,
 * and this file is the navigator, so "go to the room" swaps the screen in place
 * instead of walking out of the landing.
 *
 * The room remains visible throughout. The interface fades over its last
 * rendered frame, and the landing resumes that same view when it closes.
 */

import * as React from "react";
import dynamic from "next/dynamic";

import { AppNavProvider, pathOf, type AppNav } from "@/lib/nav";
import { useSession, useSessionReady } from "@/lib/auth/session";
import { useStore } from "@/lib/store";

import AccountChip from "./AccountChip";
import SignInGate from "./SignInGate";
import "./room3.css";

const Capture = dynamic(() => import("@/components/Capture"), { ssr: false });
const RoomScreen = dynamic(() => import("@/app/room/page"), { ssr: false });
const CheckoutScreen = dynamic(() => import("@/app/checkout/page"), { ssr: false });

export type Screen = "capture" | "room" | "checkout";

const SCREEN_OF: Record<string, Screen> = {
  "/": "capture",
  "/room": "room",
  "/cart": "checkout",
  "/checkout": "checkout",
};

/** Duration of the interface fade and landing handoff. Mirrored in room3.css. */
const COVER_MS = 180;

type Props = {
  /** the interface is ready: freeze the existing room behind it */
  onCovered: () => void;
  /** leaving: resume the existing room */
  onLeaving: () => void;
  /** the interface has faded out; unmount */
  onGone: () => void;
};

/**
 *   covering   wait briefly for the room entry to settle
 *   revealing  fade the interface over the frozen room
 *   open       interactive glass panel
 *   closing    fade the interface out
 *   lifting    resume the room, then release the overlay
 */
type Cover = "covering" | "revealing" | "open" | "closing" | "lifting";

const NEXT: Partial<Record<Cover, Cover>> = {
  covering: "revealing",
  revealing: "open",
  closing: "lifting",
};

/**
 * Is one of the PRODUCT's dialogs or sheets up? The landing keeps its own
 * `role="dialog"` pages in the DOM, hidden, behind this room — those do not count.
 */
function productDialogOpen(): boolean {
  const found = document.querySelectorAll("[role='dialog'], .react-modal-sheet-container");
  return Array.from(found).some((el) => !el.closest(".sense"));
}

/** Is the entry on top of the history stack the one that stands for "inside the product"? */
function ownsHistoryEntry(): boolean {
  return (window.history.state as { pixx?: string } | null)?.pixx === "room3";
}

export default function ProductRoom({ onCovered, onLeaving, onGone }: Props) {
  const session = useSession();
  // Resolve the session before choosing the entry card action.
  const known = useSessionReady();
  const [entered, setEntered] = React.useState(false);
  const admitted = Boolean(session && entered);
  const hasRoom = useStore((s) => s.roomImage !== null);

  const [cover, setCover] = React.useState<Cover>("covering");
  // a shopper who already photographed the room comes back to it, not to the camera
  const [stack, setStack] = React.useState<Screen[]>(() => [hasRoom ? "room" : "capture"]);
  const screen = stack[stack.length - 1];

  // the callbacks come from a parent that re-renders; the timers must not restart for it
  const calls = React.useRef({ onCovered, onLeaving, onGone });
  React.useEffect(() => {
    calls.current = { onCovered, onLeaving, onGone };
  });

  /*
   * A timer walks the cover, not an animation event: a tab that is not being
   * painted never fires one, and a product that waits on it never opens.
   */
  React.useEffect(() => {
    if (cover === "open") return;
    const timer = window.setTimeout(() => {
      if (cover === "covering") calls.current.onCovered();
      if (cover === "closing") calls.current.onLeaving();
      if (cover === "lifting") {
        calls.current.onGone();
        return;
      }
      const next = NEXT[cover];
      if (next) setCover(next);
    }, COVER_MS);
    return () => window.clearTimeout(timer);
  }, [cover]);

  /** true while the next popstate is one we caused, and must not be answered */
  const quietPop = React.useRef(false);

  // read by `leave`, which must act once: a state updater may run twice in
  // development, and "go back one history entry" twice leaves the site
  const coverRef = React.useRef(cover);
  React.useEffect(() => {
    coverRef.current = cover;
  }, [cover]);

  const leave = React.useCallback(() => {
    if (coverRef.current !== "open") return;
    coverRef.current = "closing";
    // the option sheet's open flag is module state and would outlive this room:
    // leave with it up and it is up again, over nothing, on the way back in
    void import("@/components/OptionSheet").then((m) => m.closeOptions());
    // left through the interface, not with Back: take our history entry off
    if (ownsHistoryEntry()) {
      quietPop.current = true;
      window.history.back();
    }
    setCover("closing");
  }, []);

  const nav = React.useMemo<AppNav>(
    () => ({
      embedded: true,
      push: (href) => {
        const next = SCREEN_OF[pathOf(href)];
        if (!next) return;
        setStack((s) => (s[s.length - 1] === next ? s : [...s, next]));
      },
      back: () => {
        setStack((s) => {
          if (s.length > 1) return s.slice(0, -1);
          // checkout reached without a history still has the room behind it
          if (s[0] === "checkout") return ["room"];
          return s;
        });
      },
    }),
    []
  );

  // a handle for the dev console and the browser tests: the store, the preview
  // and the navigator. Never in a production build.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let live = true;
    void import("@/lib/preview").then(({ usePreview }) => {
      if (live) Object.assign(window, { __pixx: { useStore, usePreview, nav } });
    });
    return () => {
      live = false;
      delete (window as { __pixx?: unknown }).__pixx;
    };
  }, [nav]);

  /*
   * THE BROWSER'S BACK BUTTON WALKS THE PRODUCT, THEN LEAVES IT — it must not
   * leave the site. The whole product is one URL, so without this a Back (or a
   * trackpad swipe) on the checkout throws away the room and everything in it.
   * One extra history entry stands for "inside the product"; each Back is
   * answered as the in-app back, and the entry is put back while there is still
   * somewhere to go. Same URL every time, which Next's router treats as a no-op.
   */
  const stackRef = React.useRef(stack);
  React.useEffect(() => {
    stackRef.current = stack;
  }, [stack]);
  React.useEffect(() => {
    // idempotent, so a double-mounted effect (StrictMode) leaves one entry, not two
    const mark = () => {
      if (ownsHistoryEntry()) return;
      window.history.pushState({ ...(window.history.state ?? {}), pixx: "room3" }, "");
    };
    mark();
    const onPop = () => {
      // the pop we caused ourselves when leaving through the interface
      if (quietPop.current) {
        quietPop.current = false;
        return;
      }
      if (productDialogOpen()) {
        // a dialog is up: Back closes that first (it listens for Escape)
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        mark();
        return;
      }
      if (stackRef.current.length > 1) {
        nav.back();
        mark();
      } else {
        leave();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [nav, leave]);

  // Share the room palette with product controls and body-portalled dialogs.
  React.useEffect(() => {
    const html = document.documentElement;
    html.classList.add("pixx-room-open");
    return () => html.classList.remove("pixx-room-open");
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // a sheet or a field takes the first Escape; the room only takes a bare one
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (productDialogOpen()) return;
      leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  const mounted = cover === "revealing" || cover === "open" || cover === "closing";
  const paper = cover === "open" ? null : cover === "covering" || cover === "closing" ? "in" : "out";

  return (
    <div className="pixx-room-root" data-cover={cover} data-screen={admitted ? screen : "gate"}>
      {mounted ? (
        <div className="pixx-room-app">
          <AppNavProvider value={nav}>
            {!known ? null : admitted ? (
              <>
                <div className="pixx-room-screen" key={screen}>
                  {screen === "capture" ? <Capture /> : null}
                  {screen === "room" ? <RoomScreen /> : null}
                  {screen === "checkout" ? <CheckoutScreen /> : null}
                </div>
                <AccountChip screen={screen} onLeave={leave} />
              </>
            ) : (
              <SignInGate onLeave={leave} onContinue={() => setEntered(true)} />
            )}
          </AppNavProvider>
        </div>
      ) : null}

      {paper ? <div className="pixx-room-paper" data-dir={paper} aria-hidden /> : null}
    </div>
  );
}
