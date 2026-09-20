import type { NextRequest } from "next/server";

import { getRun } from "@/lib/checkout/runs";

/**
 * GET /api/checkout/{runId} — where the walk has got to.
 *
 * Out: { runId, lines: [{ lineId, status }], finishedAt, instructionId }
 *
 * The polling answer. `stream/` beside this file pushes the same transitions
 * over SSE and is what the UI uses; this one exists so a client that cannot
 * hold a stream open — or a person with curl at the booth — can still read the
 * run, and so the stream has a fallback that needs no new server code.
 *
 * `params` IS A PROMISE IN THIS VERSION OF NEXT and the old synchronous
 * signature does not compile. `RouteContext<'/api/checkout/[runId]'>` is a
 * globally available helper generated during `next build`; it needs no import.
 * See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md.
 */

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/checkout/[runId]">
) {
  const { runId } = await context.params;
  const run = getRun(runId);

  if (!run) {
    return Response.json(
      { error: "That checkout run is not on this server any more. Press checkout again." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    {
      runId: run.runId,
      lines: run.lines,
      finishedAt: run.finishedAt,
      instructionId: run.instructionId,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
