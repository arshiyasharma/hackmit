"use client";

import { useState } from "react";
import SignupForm from "./SignupForm";

const PROMISES = ["see it to scale", "fits through the door", "under budget, always"];

export default function WaitlistScreen({ initialTotal }: { initialTotal: number | null }) {
  const [total, setTotal] = useState(initialTotal);

  return (
    <>
      <main className="wl-main">
        <span className="wl-pill wl-rise">
          <i className="wl-dot" aria-hidden />
          early invites, rolling out in batches
        </span>

        <h1 className="wl-title wl-rise" style={{ animationDelay: "0.08s" }}>
          shop furniture that <em>actually fits</em>.
        </h1>

        <p className="wl-sub wl-rise" style={{ animationDelay: "0.16s" }}>
          PIXX-AR stands real pieces in your real room in ar, checks they clear your doorway,
          and keeps the whole cart under budget — before you ever hit buy.
        </p>

        <SignupForm onJoined={setTotal} />
      </main>

      <footer className="wl-foot">
        <ul>
          {PROMISES.map((promise) => (
            <li key={promise}>
              <i className="wl-tick" aria-hidden />
              {promise}
            </li>
          ))}
        </ul>
        {total !== null && total > 0 ? (
          <p className="wl-count">
            <b>{total.toLocaleString()}</b> {total === 1 ? "person" : "people"} waiting
          </p>
        ) : null}
      </footer>
    </>
  );
}
