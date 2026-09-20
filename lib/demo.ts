"use client";

/**
 * Demo mode — the expo insurance policy.
 *
 * `?demo=1` anywhere in the flow turns it on for the rest of the session. The
 * UI, the timings and the copy are identical; the only difference is that the
 * read calls carry `demo=1`, so the routes can replay the frozen listings in
 * data/frozen/ and a pre-warmed variant cache instead of gambling on conference
 * wifi.
 *
 * /api/checkout is DELIBERATELY not flagged. The payment is the one call that
 * still goes out for real at the expo, and the confirmation's "Simulated" chip
 * is read off that response — a demo flag must never be able to decide it.
 *
 * The flag has to be sticky. Capture routes to /design, /design routes to /ar,
 * and a client-side push drops the query string — so the flag is remembered in
 * sessionStorage the first time it is seen and read back from there after.
 * sessionStorage, not localStorage: a new tab starts honest.
 */

import { useSyncExternalStore } from "react";

const KEY = "visa.demo";

/** Is this session running against frozen data? */
export function isDemo(): boolean {
  if (typeof window === "undefined") return false;

  let sticky = false;
  try {
    sticky = window.sessionStorage.getItem(KEY) === "1";
  } catch {
    // private mode, blocked storage — the URL is still authoritative
  }

  const param = new URLSearchParams(window.location.search).get("demo");
  if (param === "1") {
    if (!sticky) {
      try {
        window.sessionStorage.setItem(KEY, "1");
      } catch {
        /* nothing to do; the flag just won't survive the next route change */
      }
    }
    return true;
  }
  // ?demo=0 turns it back off, so one URL can undo another
  if (param === "0") {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return false;
  }

  return sticky;
}

/**
 * Add `demo=1` to an API URL when the session is in demo mode.
 * Every fetch in the app goes through this, so a route can never be missed.
 */
export function withDemo(url: string): string {
  if (!isDemo()) return url;
  return url + (url.includes("?") ? "&" : "?") + "demo=1";
}

/** Carry the flag across a client-side navigation. */
export function demoHref(path: string): string {
  return withDemo(path);
}

/*
 * The flag lives in the URL and in sessionStorage, neither of which the server
 * can see, so a component that renders it has to read it AFTER hydration or
 * the markup mismatches. useSyncExternalStore does exactly that: false on the
 * server and on the first client render, the real value immediately after.
 * The flag never changes mid-render, so `subscribe` has nothing to listen to.
 */
const noopSubscribe = () => () => {};
const serverSnapshot = () => false;

/** Is this session in demo mode? Safe to call during render. */
export function useDemo(): boolean {
  return useSyncExternalStore(noopSubscribe, isDemo, serverSnapshot);
}
