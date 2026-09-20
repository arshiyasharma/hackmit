"use client";

/**
 * Is this the laptop layout?
 *
 * The product is a website first: a wide room canvas, a glass agent panel down
 * the right-hand side, a listing tray docked under the room, dialogs instead of
 * bottom sheets. Under 900px it falls back to the older single column.
 *
 * The same number is the `desk:` Tailwind breakpoint in app/globals.css
 * (`--breakpoint-desk`). Prefer the CSS variant whenever only styles change;
 * use this hook only when the STRUCTURE differs (a tray instead of a sheet).
 *
 * False on the server and on the first client render, the real answer right
 * after — so a server-rendered route hydrates cleanly and then settles.
 */

import { useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 56.25rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

/** For code outside React (an event handler deciding hover vs tap). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches;
}
