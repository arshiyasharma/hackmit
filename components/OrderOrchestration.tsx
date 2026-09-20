"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  retailers: string[];
  visaToken: string;
  amount: number;
  itemCount: number;
  firstName?: string | null;
};

// Deterministic fake order number per retailer so it's stable across a demo run.
function orderNumber(retailer: string, seed: string) {
  const prefix = retailer.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
  let h = 0;
  for (const c of retailer + seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${prefix}-${(1000 + (h % 9000)).toString()}`;
}

const ETAS = ["arrives fri, sep 25", "arrives sat, sep 26", "arrives mon, sep 28", "arrives tue, sep 29"];

type Step = { key: string; label: string; sub?: string };

const STEP_MS = 750;

export default function OrderOrchestration({ retailers, visaToken, amount, itemCount, firstName }: Props) {
  const steps: Step[] = [
    { key: "passkey", label: firstName ? `verified as ${firstName} with passkey` : "verified with passkey" },
    { key: "visa", label: "tokenized with visa", sub: visaToken },
    ...retailers.map((r, i) => ({
      key: r,
      label: `order placed · ${r}`,
      sub: `${orderNumber(r, visaToken)} · ${ETAS[i % ETAS.length]}`,
    })),
  ];

  // Number of fully-completed steps. steps[completed] is the one in progress.
  const [completed, setCompleted] = useState(0);
  const done = completed >= steps.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setCompleted((c) => c + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [completed, done]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <div className="w-full max-w-md">
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="text-center mb-8"
            >
              <div className="text-4xl text-[#C97B5F] mb-3">✓</div>
              <h1 className="text-2xl">order confirmed</h1>
              <p className="text-black/60 mt-1">
                {itemCount} items · {retailers.length} retailers · one payment
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-3">
          {steps.map((step, i) => {
            const state = i < completed ? "done" : i === completed ? "active" : "pending";
            if (state === "pending") return null;
            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="flex items-center gap-3"
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  {state === "done" ? (
                    <motion.span
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.35, ease: "easeOut" }}
                      className="text-[#C97B5F] text-sm"
                    >
                      ✓
                    </motion.span>
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-black/25 border-t-black/60 animate-spin" />
                  )}
                </span>
                <div className="flex flex-col">
                  <span className={`text-sm ${state === "done" ? "text-black/80" : "text-black/50"}`}>
                    {step.label}
                  </span>
                  {step.sub && state === "done" && (
                    <span className="text-xs text-black/40 font-mono">{step.sub}</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
              className="mt-8 flex flex-col items-center gap-2"
            >
              <div className="px-4 py-2 rounded-full bg-black/5 text-sm font-mono">
                •••• 4242 · visa token: {visaToken}
              </div>
              <p className="text-xs text-black/40">
                ${amount.toFixed(2)} charged once · secured with passkey · tokenized by visa
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
