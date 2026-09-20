import type { NextRequest } from "next/server";

import { cutoutFromListing } from "@/lib/cutout";

/**
 * POST /api/cutout — { imageUrl } in, { url, widthRatio } out.
 *
 * The sprite standing in the room becomes the product the user actually linked:
 * the listing's own photo, keyed off its white background and trimmed to the
 * object. Cached by URL, so relinking back and forth costs one fetch each.
 *
 * NEVER 500s and never blocks the link. A photo that will not key cleanly
 * answers 200 with { url: null }, and the room keeps the generated stand-in —
 * a drawing that is honest about being a drawing beats a cutout with a slice of
 * someone else's room stuck to it.
 */

export const runtime = "nodejs";
export const maxDuration = 20;

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
    const cut = await cutoutFromListing(imageUrl);
    if (!cut) {
      return Response.json({
        url: null,
        note: "That photo is not on a plain background — keeping the stand-in.",
      });
    }
    return Response.json({
      url: cut.url,
      widthRatio: cut.widthRatio,
      keyedRatio: cut.keyedRatio,
      trimmedRatio: cut.trimmedRatio,
    });
  } catch {
    return Response.json({ url: null, note: "Could not read that photo." });
  }
}
