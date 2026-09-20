import { checkoutOwner } from "@/lib/checkout/request";
import type { NextRequest } from "next/server";

import { isRunFinished, getRun } from "@/lib/checkout/runs";
import type { RunLine } from "@/lib/checkout/types";

/**
 * GET /api/checkout/{runId}/stream — the walk, pushed as it happens.
 *
 * Server-Sent Events. One message per line transition, so the overlay redraws
 * when a line actually moves instead of polling four times a second and
 * redrawing when nothing has changed.
 *
 * Each message is JSON on a `data:` line:
 *   { type: "line", lineId, status }   a line moved
 *   { type: "done", finishedAt }       every line is terminal; the stream ends
 * plus a `: keepalive` comment every 15 s so nothing between us and the
 * browser decides an idle connection is a dead one.
 *
 * WHY IT POLLS THE STORE INSTEAD OF LISTENING FOR EVENTS. The run store is a
 * Map in this process and `runCheckout` writes to it directly; an emitter
 * between them would be a second source of truth to keep in sync for no gain
 * at four lines. The poll is in-process memory reads every 120 ms and touches
 * nothing outside this server.
 *
 * IF THIS FIGHTS THE PLATFORM, DELETE IT. `GET /api/checkout/{runId}` beside
 * this file returns the same line statuses, and a client polling it every
 * 500 ms shows the same walk. Losing SSE costs the demo nothing; losing an
 * hour to it costs the demo a lot.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** In-process memory reads. Fast enough to look instant, slow enough to be free. */
const POLL_MS = 120;
const KEEPALIVE_MS = 15_000;

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** What we last told the client about each line, so only changes are sent. */
function snapshot(lines: readonly RunLine[]): Map<string, string> {
  return new Map(lines.map((line) => [line.lineId, JSON.stringify(line.status)]));
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/checkout/[runId]/stream">
) {
  const { runId } = await context.params;

  const initial = getRun(runId);
  if (!initial || !initial.ownerId || initial.ownerId !== checkoutOwner(request)) {
    return Response.json(
      { error: "That checkout run is not on this server any more. Press checkout again." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const encoder = new TextEncoder();

  let cancelStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let sent = new Map<string, string>();

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // the client went away between our check and this write
          stop();
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(keepalive);
        clearTimeout(deadline);
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          /* already closed by the runtime */
        }
      };

      const tick = () => {
        const run = getRun(runId);
        if (!run) {
          stop();
          return;
        }

        const current = snapshot(run.lines);
        for (const line of run.lines) {
          const next = current.get(line.lineId);
          if (next !== sent.get(line.lineId)) {
            send(frame({ type: "line", lineId: line.lineId, status: line.status }));
          }
        }
        sent = current;

        if (isRunFinished(run)) {
          send(frame({ type: "done", finishedAt: run.finishedAt }));
          stop();
        }
      };

      const poll = setInterval(tick, POLL_MS);
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);

      const deadline = setTimeout(stop, 55_000);
      cancelStream = stop;
      request.signal.addEventListener("abort", stop);
      if (request.signal.aborted) { stop(); return; }

      // the current state goes out immediately, so a client that connects late
      // is not staring at an empty list until the next line moves
      tick();
    },
    cancel() { cancelStream(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // nginx and some CDNs buffer a response until it ends, which turns a
      // live stream into one silent block at the finish
      "X-Accel-Buffering": "no",
    },
  });
}
