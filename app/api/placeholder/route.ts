/**
 * /api/placeholder — the stand-in sprite for one object.
 *
 * POST { category, roomContext, request? } -> { url, widthRatio, ... }
 * GET  ?key=<sha256>                       -> the cached PNG itself
 *
 * `widthRatio` is natural width over height AFTER the trim. The AR scene
 * multiplies the linked listing's real height by it, so a wrong ratio
 * distorts every object standing in the room.
 *
 * This runs in the Node runtime — which is the default, and the docs say not
 * to export `runtime` any more — because lib/placeholder.ts spawns the
 * authenticated Higgsfield CLI as a child process and runs sharp. Every one of
 * those calls stays on the server; no credential is ever in the browser bundle.
 */

import type { NextRequest } from "next/server";

import {
  readCachedPng,
  resolvePlaceholder,
  type PlaceholderInput,
} from "@/lib/placeholder";

export const dynamic = "force-dynamic";
/** One generation can take the better part of three minutes. */
export const maxDuration = 300;

const KEY_RE = /^[0-9a-f]{64}$/;

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key || !KEY_RE.test(key)) {
    return Response.json(
      { error: "Ask for a stand-in first — this link needs its key." },
      { status: 400 },
    );
  }

  const hit = await readCachedPng(key);
  if (!hit) {
    return Response.json(
      { error: "That stand-in has expired. Add the item again to redraw it." },
      { status: 404 },
    );
  }

  // The key is a hash of the image's own inputs, so the bytes behind a given
  // URL never change and the browser may hold it forever.
  return new Response(new Uint8Array(hit.png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(hit.png.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Placeholder-Source": hit.entry.source,
      "X-Placeholder-Width-Ratio": hit.entry.widthRatio.toFixed(6),
    },
  });
}

type Body = {
  category?: unknown;
  request?: unknown;
  roomContext?: unknown;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json(
      { error: "Send a category and the room context as JSON." },
      { status: 400 },
    );
  }

  const raw = (body?.roomContext ?? null) as PlaceholderInput["roomContext"];

  try {
    const result = await resolvePlaceholder(
      {
        category: typeof body?.category === "string" ? body.category : "",
        request: typeof body?.request === "string" ? body.request : null,
        roomContext: raw && typeof raw === "object" ? raw : null,
      },
      request.signal,
    );
    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/placeholder]", err);
    return Response.json(
      { error: "Couldn't draw a stand-in for that. Ask for it again." },
      { status: 502 },
    );
  }
}
