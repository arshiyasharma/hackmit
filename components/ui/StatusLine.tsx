"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { DUR, EASE, EXIT, REDUCED } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * THIS REPLACES EVERY SPINNER IN THE APP.
 *
 * Crossfades plain-language status messages while work is in flight. Each
 * message names what is happening right now — "Reading the dimensions off the
 * IKEA listing", not "Loading...".
 */

export type StatusLineProps = {
  messages: string[];
  /** how long each message holds before the next one fades in */
  intervalMs?: number;
  className?: string;
  /** stop cycling and hold the last message, e.g. once the work lands */
  paused?: boolean;
};

export function StatusLine({
  messages,
  intervalMs = 2600,
  className,
  paused = false,
}: StatusLineProps) {
  const reduced = useReducedMotion();

  /*
   * Callers pass an inline array, so `messages` is a new object on every
   * render. Key the cycle on the CONTENT, not the identity, or the interval
   * restarts on every render and the line never advances.
   */
  const key = messages.join("\u0000");
  const count = messages.length;

  // one piece of state, so a new message list restarts at the top without an
  // effect that calls setState (which would cascade a render)
  const [cursor, setCursor] = React.useState({ key, index: 0 });
  const index = cursor.key === key ? cursor.index : 0;

  React.useEffect(() => {
    if (paused || count < 2) return;
    const id = window.setInterval(() => {
      setCursor((c) => ({
        key,
        index: c.key === key ? (c.index + 1) % count : 0,
      }));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [key, count, intervalMs, paused]);

  if (count === 0) return null;

  const message = messages[Math.min(index, count - 1)];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative min-h-[1.5rem] text-sm text-muted-foreground",
        className
      )}
    >
      {/*
       * A line is a small thing, so it moves on the small clock: the new
       * sentence rises in on the entrance curve, the old one leaves on the exit
       * curve, both `DUR.micro`. Reduced motion keeps the words and drops the
       * travel.
       */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={message}
          className="block"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={
            reduced
              ? { opacity: 1, transition: REDUCED }
              : { opacity: 1, y: 0, transition: { duration: DUR.micro, ease: EASE.out } }
          }
          exit={
            reduced
              ? { opacity: 0, transition: REDUCED }
              : { opacity: 0, y: -6, transition: EXIT }
          }
        >
          {message}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

export default StatusLine;
