import type { NextRequest } from "next/server";

import { cutoutFromListing } from "@/lib/cutout";

/**
 * POST /api/cutout — { imageUrl } in, { url, widthRatio } out.
 *
 * The sprite standing in the room becomes the product the user actually linked:
 * the listing's own photo, with its background removed and trimmed to the
 * object. Cached by URL, so relinking back and forth costs one fetch each.
 *
 * Uses a quick packshot mask, then fast local segmentation for complex images.
 * Imperfect/cropped foregrounds are usable; only absent or invalid mattes fail.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let imageUrl: string | null = null;
  try {
    const body = (await request.json()) as { imageUrl?: unknown };
    if (typeof body.imageUrl === "string") imageUrl = body.imageUrl;
  } catch {
    /* an unreadable body is just a miss */
  }

  if (!imageUrl) {
    return Response.json({ url: null, note: "No image on that listing." });
  }

  try {
    const cut = await cutoutFromListing(imageUrl, AbortSignal.any([request.signal, AbortSignal.timeout(28_000)]));
    if (!cut) {
      // a refusal is a decision, and a silent one looks like a broken feature
      console.info(`[cutout] refused ${imageUrl.slice(0, 90)}`);
      return Response.json({
        url: null,
        note: "Couldn’t read a usable product photo. Try another listing or retry.",
      });
    }
    console.info(
      `[cutout] keyed ${imageUrl.slice(0, 70)} — ` +
        `keyed ${cut.keyedRatio.toFixed(2)}, trimmed ${cut.trimmedRatio.toFixed(2)}`
    );
    return Response.json({
      url: cut.url,
      version: cut.version,
      widthRatio: cut.widthRatio,
      keyedRatio: cut.keyedRatio,
      trimmedRatio: cut.trimmedRatio,
      keyed: cut.keyed,
    });
  } catch {
    return Response.json({ url: null, note: "Could not read that photo." });
  }
}
