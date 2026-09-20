"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentEvent, PurchaseRecord, SpendMandate } from "@/lib/agents/types";

type Line = { kind: "info" | "pass" | "halt"; text: string; sub?: string };

type AgentState = {
  retailer: string;
  status: "dispatched" | "working" | "purchasing" | "done" | "failed";
  lines: Line[];
  order?: PurchaseRecord;
};

type Props = {
  payload: unknown;
  onDone?: () => void;
};

function reduce(agents: Map<string, AgentState>, e: AgentEvent) {
  const next = new Map(agents);
  const get = (r: string): AgentState =>
    next.get(r) ?? { retailer: r, status: "dispatched", lines: [] };

  switch (e.type) {
    case "dispatched":
      next.set(e.retailer, { retailer: e.retailer, status: "dispatched", lines: [] });
      break;
    case "verifying": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, status: "working", lines: [...a.lines, { kind: "info", text: `verifying ${e.title}` }] });
      break;
    }
    case "verified": {
      const a = get(e.retailer);
      const lines = [...a.lines];
      lines[lines.length - 1] = {
        kind: "info",
        text: `verified ${e.title}`,
        sub: [e.dims, e.color].filter(Boolean).join(" · "),
      };
      next.set(e.retailer, { ...a, lines });
      break;
    }
    case "constraint_pass": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, lines: [...a.lines, { kind: "pass", text: "cleared to buy", sub: e.notes.join(" · ") }] });
      break;
    }
    case "halted": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, lines: [...a.lines, { kind: "halt", text: `held · ${e.title}`, sub: e.reason }] });
      break;
    }
    case "purchasing": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, status: "purchasing" });
      break;
    }
    case "purchased": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, status: "done", order: e.order });
      break;
    }
    case "failed": {
      const a = get(e.retailer);
      next.set(e.retailer, { ...a, status: "failed", lines: [...a.lines, { kind: "halt", text: "failed", sub: e.error }] });
      break;
    }
  }
  return next;
}

export default function AgentSwarm({ payload, onDone }: Props) {
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [mandate, setMandate] = useState<SpendMandate | null>(null);
  const [summary, setSummary] = useState<Extract<AgentEvent, { type: "swarm_done" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/checkout/swarm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok || !res.body) {
          const msg = await res.json().catch(() => ({ error: "Swarm failed to start" }));
          setError(msg.error ?? "Swarm failed to start");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as AgentEvent;
            if (event.type === "swarm_start") setMandate(event.mandate);
            else if (event.type === "swarm_done") setSummary(event);
            else setAgents((prev) => reduce(prev, event));
          }
        }
        onDone?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Swarm connection lost");
      }
    })();
  }, [payload, onDone]);

  const list = [...agents.values()];
  const spent = summary?.totalUsd ?? 0;

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-red-500 text-sm">{error}</p>
        <p className="text-black/40 text-xs">no charge was made · your cart is untouched</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl">
          {summary ? "orders placed" : `${list.length || "…"} agents working`}
        </h1>
        {mandate && (
          <p className="text-sm text-black/50">
            spend mandate ${mandate.budgetUsd} · agents transact freely below it
            {mandate.spaceAware && " · constrained to what fits your room"}
          </p>
        )}
      </header>

      {/* one column per retailer agent — they run in parallel */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((a) => (
          <motion.div
            key={a.retailer}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="border border-black/10 rounded-xl p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm">{a.retailer}</span>
              <span className="text-xs text-black/40">
                {a.status === "done" ? "ordered" : a.status === "failed" ? "failed" : a.status}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {a.lines.map((l, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="flex gap-2 items-start"
                >
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      l.kind === "pass" ? "bg-[#C97B5F]" : l.kind === "halt" ? "bg-amber-500" : "bg-black/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <span className={`text-xs ${l.kind === "halt" ? "text-amber-700" : "text-black/70"}`}>
                      {l.text}
                    </span>
                    {l.sub && <span className="text-[11px] text-black/40 font-mono">{l.sub}</span>}
                  </div>
                </motion.div>
              ))}
            </div>

            {a.order && (
              <div className="pt-2 border-t border-black/10 text-[11px] font-mono text-black/50">
                {a.order.orderId} · ${a.order.amountUsd.toFixed(2)}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {summary && (
          <motion.footer
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-2 pt-4 border-t border-black/10"
          >
            <p className="text-sm text-black/70">
              {summary.purchased.length} {summary.purchased.length === 1 ? "retailer" : "retailers"} · one
              payment · ${spent.toFixed(2)}
            </p>
            {summary.visaToken && (
              <div className="px-4 py-2 rounded-full bg-black/5 text-sm font-mono">
                •••• 4242 · visa token: {summary.visaToken}
              </div>
            )}
            {summary.halted.length > 0 && (
              <div className="mt-2 text-center">
                <p className="text-amber-700 text-xs">
                  {summary.halted.length} item{summary.halted.length === 1 ? "" : "s"} held for your approval
                </p>
                {summary.halted.map((h, i) => (
                  <p key={i} className="text-[11px] text-black/40">
                    {h.title} · {h.reason}
                  </p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-black/40 mt-1">
              authorized once with your passkey · tokenized by visa
            </p>
          </motion.footer>
        )}
      </AnimatePresence>
    </div>
  );
}
