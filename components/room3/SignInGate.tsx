"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";

import { continueAsGuest, signInWithGoogle, useSession } from "@/lib/auth/session";

import "./sign-in-glass.css";

type Status = "idle" | "connecting" | "failed" | "leaving";

/** The real Supabase callback reports a failed exchange with `?error=auth`. */
function cameBackFailed(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "auth";
}

type Props = {
  onLeave: () => void;
  onContinue?: () => void;
};

export default function SignInGate({ onLeave, onContinue }: Props) {
  const session = useSession();
  const [status, setStatus] = React.useState<Status>(() => (cameBackFailed() ? "failed" : "idle"));
  const [problem, setProblem] = React.useState<string | null>(() =>
    cameBackFailed() ? "Google sign-in didn’t complete. Please try again." : null
  );
  const [previewAvailable, setPreviewAvailable] = React.useState(false);
  const busy = status === "connecting" || status === "leaving";

  const google = React.useCallback(async () => {
    if (busy) return;
    setStatus("connecting");
    setProblem(null);
    setPreviewAvailable(false);

    try {
      const result = await signInWithGoogle();
      if (result.ok) return; // Keep the pending state while the browser leaves for Google.
      const unavailable = result.reason === "not-configured";
      setProblem(
        unavailable
          ? "Google sign-in isn’t connected in this local preview. You can explore without signing in."
          : "Google sign-in couldn’t connect. Please try again."
      );
      setPreviewAvailable(unavailable);
    } catch {
      setProblem("Google sign-in couldn’t connect. Please try again.");
    }
    setStatus("failed");
  }, [busy]);

  const preview = React.useCallback(() => {
    if (busy) return;
    setStatus("leaving");
    continueAsGuest();
    onContinue?.();
  }, [busy, onContinue]);

  return (
    <section className="pixx-gate pixx-entry" aria-labelledby="pixx-gate-name">
      <button type="button" className="pixx-back" onClick={onLeave}>
        <ChevronLeft size={17} aria-hidden />
        Back to rooms
      </button>

      <div className="pixx-gate-content">
        <h1 id="pixx-gate-name" className="pixx-gate-name">Your room, reimagined.</h1>
        <p className="pixx-gate-deck">
          {session
            ? "Continue designing, right here in your room."
            : "Sign in to start designing, right here in your room."}
        </p>

        <button
          type="button"
          className="pixx-google"
          onClick={session ? onContinue : google}
          disabled={busy}
          aria-busy={status === "connecting"}
          aria-describedby={problem ? "pixx-gate-error" : undefined}
        >
          {!session ? <span className="pixx-google-mark"><GoogleMark /></span> : null}
          <span aria-live="polite">
            {session
              ? "Continue to studio"
              : status === "connecting"
                ? "Connecting to Google…"
                : "Continue with Google"}
          </span>
        </button>

        {problem ? (
          <p id="pixx-gate-error" className="pixx-gate-error" role="alert">{problem}</p>
        ) : null}
        {previewAvailable && !session ? (
          <button type="button" className="pixx-gate-preview" onClick={preview} disabled={busy}>
            Explore without signing in
          </button>
        ) : null}
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
