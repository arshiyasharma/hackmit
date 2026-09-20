"use client";

/**
 * The door to room III: sign in, on glass.
 *
 * "Continue with Google" is the real thing — Supabase OAuth, through
 * lib/auth/session.ts. The browser leaves for Google and comes back to
 * `/landing?product`, which opens this room again with the session in place.
 * On a machine without the Supabase keys the button says so, in words, and
 * "Continue as guest" is the way in. Nobody's name is ever made up.
 *
 * There is no spinner anywhere in the product. The wait is a line of light
 * along the foot of the button and a sentence that says what is happening.
 */

import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { continueAsGuest, signInWithGoogle } from "@/lib/auth/session";

/** room III itself — the red room the shopper just walked into — so the door matches it */
const ROOM = "/assets/rooms/R3.avif";

const STEPS = [
  { n: "01", t: "Photograph your room" },
  { n: "02", t: "Ask for one thing" },
  { n: "03", t: "Approve once" },
] as const;

type Status = "idle" | "connecting" | "failed" | "leaving";

/** `/auth/callback` sends a failed exchange back with `?error=auth`. */
function cameBackFailed(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "auth";
}

export default function SignInGate({ onLeave }: { onLeave: () => void }) {
  const [status, setStatus] = React.useState<Status>(() => (cameBackFailed() ? "failed" : "idle"));
  const [problem, setProblem] = React.useState<string | null>(() =>
    cameBackFailed() ? "Google sign-in didn't complete. Try again, or continue as a guest." : null
  );
  const busy = status === "connecting" || status === "leaving";

  const google = React.useCallback(async () => {
    if (busy) return;
    setStatus("connecting");
    setProblem(null);
    const result = await signInWithGoogle();
    if (result.ok) return; // the page is on its way to Google; keep the wait up
    setProblem(result.message);
    setStatus("failed");
  }, [busy]);

  const guest = React.useCallback(() => {
    if (busy) return;
    setStatus("leaving");
    continueAsGuest();
  }, [busy]);

  return (
    <section className="pixx-gate" aria-labelledby="pixx-gate-name">
      <div className="pixx-gate-room" style={{ backgroundImage: `url(${ROOM})` }} aria-hidden />
      <i className="pixx-gate-light a" aria-hidden />
      <i className="pixx-gate-light b" aria-hidden />

      <button type="button" className="pixx-back glass-pill" onClick={onLeave}>
        <ChevronLeft size={18} aria-hidden />
        The rooms
      </button>

      <div className="pixx-gate-grid" data-leaving={status === "leaving"}>
        <div className="pixx-gate-hero">
          <p className="eyebrow pixx-gate-eyebrow">Room III — the product</p>
          <h1 id="pixx-gate-name" className="pixx-gate-name">
            <span className="pixx-line">
              <span>PIXX-AR</span>
            </span>
          </h1>
          <p className="pixx-gate-deck">
            Shop for the room you are standing in. Real furniture, at real size, bought with one approval.
          </p>
        </div>

        <div className="pixx-gate-card glass glass-sheen">
          <h2>Step inside</h2>
          <p className="sub">One tap, then show us your room.</p>

          <button
            type="button"
            className="pixx-google"
            onClick={google}
            disabled={status === "leaving"}
            aria-busy={status === "connecting"}
          >
            <GoogleMark />
            <span aria-live="polite">
              {status === "connecting" ? "Connecting to Google…" : "Continue with Google"}
            </span>
          </button>

          <button type="button" className="pixx-guest" onClick={guest} disabled={busy}>
            Continue as guest
          </button>

          {status === "failed" && problem ? (
            <p className="pixx-gate-error" role="alert">
              {problem}
            </p>
          ) : null}
        </div>

        <ol className="pixx-steps" aria-label="What happens next">
          {STEPS.map((step) => (
            <li key={step.n}>
              <span className="eyebrow n">{step.n}</span>
              <span className="t">{step.t}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Google's "G", as their sign-in branding guidelines draw it. */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.75 24c0-1.6.28-3.14.78-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
