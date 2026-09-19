"use client";

import { useState } from "react";
import JoinedCard from "./JoinedCard";

const OPTIONS = ["a dorm", "an apartment", "my first place", "one room"];

type Result = { position: number; total: number; alreadyIn: boolean };

export default function SignupForm({ onJoined }: { onJoined: (total: number) => void }) {
  const [email, setEmail] = useState("");
  const [furnishing, setFurnishing] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, furnishing }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "that didn't go through — try again?");
        setState("idle");
        return;
      }
      setDone(data as Result);
      onJoined(data.total);
    } catch {
      setError("no connection — check your wifi and try again?");
      setState("idle");
    }
  }

  if (done) {
    return <JoinedCard position={done.position} alreadyIn={done.alreadyIn} />;
  }

  return (
    <form className="wl-form wl-rise" onSubmit={submit} style={{ animationDelay: "0.25s" }}>
      <div className="wl-field">
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          aria-label="your email"
          autoComplete="email"
          required
        />
        <button className="wl-submit" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "saving" : "join the list"}
          <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden>
            <path
              d="M1 5h10.2M7.6 1.2 11.4 5 7.6 8.8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="wl-chips">
        <span>furnishing</span>
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="wl-chip"
            aria-pressed={furnishing === option}
            onClick={() => setFurnishing(furnishing === option ? null : option)}
          >
            {option}
          </button>
        ))}
      </div>

      {error ? (
        <p className="wl-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="wl-fine">no spam, ever. one email when your invite is ready.</p>
      )}
    </form>
  );
}
