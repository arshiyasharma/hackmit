"use client";

/**
 * Who is signed in — the one place the interface learns it.
 *
 * GOOGLE SIGN-IN IS REAL. It runs through the Supabase backend that came in
 * with the authentication branch: `lib/supabase/client.ts` starts the OAuth
 * hand-off, Google sends the shopper back to `app/auth/callback/route.ts`,
 * which swaps the code for a session cookie and forwards to `next` — and `next`
 * is `/landing?product`, so they land back inside room III, signed in.
 *
 * IT NEEDS TWO KEYS, and says so when they are missing rather than pretending:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY   (.env.local)
 * plus, in the Supabase dashboard, the Google provider switched on and
 * `<origin>/auth/callback` on the redirect allow-list. Without the keys
 * `authConfigured` is false, the Google button explains itself, and the guest
 * path is the way in. Nothing is ever faked: no name, email or picture exists
 * on screen unless Google gave it.
 *
 * A GUEST is remembered in localStorage (it is not a credential — it is the
 * absence of one). A Google session lives in Supabase's own cookies; this file
 * only mirrors it for the interface.
 *
 * Nothing here gates a payment. The API routes are anonymous today; protecting
 * them is server work for whoever owns `proxy.ts`.
 */

import { useSyncExternalStore } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

export type Session = {
  /** "guest" is the honest way in for someone who would rather not sign in */
  provider: "google" | "guest";
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  signedInAt: number;
};

/** Both public keys present at build time? Inlined by Next, so it is a constant. */
export const authConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/** Where Google sends the shopper back to, once the callback has the cookie. */
const RETURN_TO = "/landing?product";

const GUEST_KEY = "pixx.session";
const VERSION = 2;

type State = {
  session: Session | null;
  /** false until the first answer about who is signed in has arrived */
  ready: boolean;
};

let state: State = { session: null, ready: false };
const listeners = new Set<() => void>();
let started = false;
let client: SupabaseClient | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function supabase(): SupabaseClient | null {
  if (!authConfigured) return null;
  client ??= createClient();
  return client;
}

/* ------------------------------------------------------------------- guest */

function readGuest(): Session | null {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { v?: number; session?: Session };
    // anything but a current guest record is a leftover from the build that had
    // no identity provider behind it: drop it
    if (stored.v !== VERSION || stored.session?.provider !== "guest") {
      window.localStorage.removeItem(GUEST_KEY);
      return null;
    }
    return stored.session;
  } catch {
    return null; // private mode, blocked storage, a corrupt value: signed out
  }
}

function writeGuest(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(GUEST_KEY, JSON.stringify({ v: VERSION, session }));
    else window.localStorage.removeItem(GUEST_KEY);
  } catch {
    /* the session still holds for this tab */
  }
}

/* ------------------------------------------------------------------ google */

function fromUser(user: User): Session {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    provider: "google",
    name: text(meta.full_name) ?? text(meta.name),
    email: text(user.email),
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
    signedInAt: user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : Date.now(),
  };
}

/** Ask once who is signed in, then keep listening. Runs on the first subscribe. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  const guest = readGuest();
  const sb = supabase();
  if (!sb) {
    set({ session: guest, ready: true });
    return;
  }

  // a real account outranks a guest record left behind on this machine
  sb.auth
    .getSession()
    .then(({ data }) => {
      const user = data.session?.user;
      if (user) writeGuest(null);
      set({ session: user ? fromUser(user) : guest, ready: true });
    })
    .catch(() => set({ session: guest, ready: true }));

  sb.auth.onAuthStateChange((_event, next) => {
    if (next?.user) {
      writeGuest(null);
      set({ session: fromUser(next.user), ready: true });
    } else if (state.session?.provider === "google") {
      set({ session: null, ready: true });
    }
  });
}

/* -------------------------------------------------------------------- hooks */

function subscribe(fn: () => void) {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
  };
}

const SERVER: State = { session: null, ready: false };

/** null while signed out — and until `useSessionReady()` says the answer is in. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, () => state, () => SERVER).session;
}

/** False for the beat between mounting and knowing; show neither gate nor room. */
export function useSessionReady(): boolean {
  return useSyncExternalStore(subscribe, () => state, () => SERVER).ready;
}

/* ------------------------------------------------------------------ actions */

export type SignInResult =
  | { ok: true; redirecting: true }
  | { ok: false; reason: "not-configured" | "failed"; message: string };

/**
 * "Continue with Google". On success the browser LEAVES for Google, so the
 * promise resolving `ok` only means the hand-off began; the session arrives
 * after the round trip, through `start()` on the next load.
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  const sb = supabase();
  if (!sb) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Google sign-in isn't connected on this machine yet — it needs the Supabase URL and key in .env.local. You can continue as a guest.",
    };
  }

  // the expo switches ride along, so a demo session is still one after Google
  const here = new URLSearchParams(window.location.search);
  const back = new URLSearchParams(RETURN_TO.split("?")[1] ?? "");
  for (const key of ["demo", "xrsim"]) {
    const value = here.get(key);
    if (value !== null) back.set(key, value);
  }
  const next = `${RETURN_TO.split("?")[0]}?${back.toString().replace(/=(&|$)/g, "$1")}`;
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account" } },
    });
    if (error) return { ok: false, reason: "failed", message: "Google didn't answer. Try again, or continue as a guest." };
    return { ok: true, redirecting: true };
  } catch {
    return { ok: false, reason: "failed", message: "Google didn't answer. Try again, or continue as a guest." };
  }
}

/** In without an account. Nothing is remembered about a guest but that they are one. */
export function continueAsGuest(): Session {
  const session: Session = {
    provider: "guest",
    name: null,
    email: null,
    avatarUrl: null,
    signedInAt: Date.now(),
  };
  writeGuest(session);
  set({ session, ready: true });
  return session;
}

export async function signOut(): Promise<void> {
  const wasGoogle = state.session?.provider === "google";
  writeGuest(null);
  set({ session: null, ready: true });
  if (wasGoogle) {
    try {
      await supabase()?.auth.signOut();
    } catch {
      /* the cookie outlives this tab at worst; the interface is signed out */
    }
  }
}

/* -------------------------------------------------------------------- words */

/** What to call the shopper. Never invented: a name, else the email, else plain words. */
export function displayName(session: Session | null): string {
  if (!session || session.provider === "guest") return "Guest";
  return session.name ?? session.email ?? "Signed in";
}

/** One or two letters for the avatar chip; empty when there is no name to take them from. */
export function initials(session: Session | null): string {
  const from = session?.name ?? session?.email ?? "";
  const words = from.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
