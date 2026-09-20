import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runSwarm } from "@/lib/agents/swarm";
import type { AgentEvent } from "@/lib/agents/types";

/**
 * Dispatches the retailer agent swarm and streams their progress back as SSE.
 * One request per "buy everything" tap.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    items?: unknown;
    budget?: number;
    perItemMaxUsd?: number;
    doorway?: { width: number; height: number } | null;
    room?: { width: number; depth: number; height: number } | null;
    expected?: { colorFamily?: string; maxDims?: { h?: number; w?: number; d?: number } };
    spaceAware?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "Cart is empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof body.budget !== "number" || !(body.budget > 0)) {
    return new Response(JSON.stringify({ error: "A spend mandate (budget) is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const send = (e: AgentEvent) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const events = runSwarm({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          items: items as any,
          mandate: {
            budgetUsd: body.budget as number,
            perItemMaxUsd: body.perItemMaxUsd,
            spaceAware: body.spaceAware !== false,
          },
          doorway: body.doorway ?? null,
          room: body.room ?? null,
          expected: body.expected,
          userId,
        });

        for await (const event of events) {
          controller.enqueue(send(event));
        }
      } catch (err) {
        controller.enqueue(
          send({
            type: "failed",
            retailer: "swarm",
            error: err instanceof Error ? err.message : "Swarm failed",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
