import type { NextRequest } from "next/server";

import { cutoutFromListing } from "@/lib/cutout";

/**
 * POST /api/cutout — { imageUrl } in, { url, widthRatio, keyed } out.
 *
 * The sprite standing in the room becomes the product the user actually linked:
 * the listing's own photo, keyed off its white background and trimmed to the
 * object. Cached by URL, so relinking back and forth costs one fetch each.
 *
 * NEVER 500s and never blocks the link. A photo that cannot be used at all —
 * unreachable, not an image, shaped like a banner — answers 200 with
 * { url: null } and the room keeps the generated stand-in.
 *
 * `keyed` IS PART OF THE ANSWER AND THE CALLER MUST STORE IT.
 *
 * A photo whose background would not come off cleanly still comes back with a
 * url, untouched and opaque, because refusing outright left a drawing standing
 * where the user had just chosen a real product. The cost of that is a whole
 * rectangular picture in the middle of the room, which some people want and
 * some people very much do not. This flag is how the room tells the two apart:
 * false means the picture arrived with its own background still on it, and the
 * store defaults such an item to the drawing while leaving the photo one tap
 * away. Drop the flag on the floor and every listing looks cleanly keyed.
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
      // a refusal is a decision, and a silent one looks like a broken feature
      console.info(`[cutout] refused ${imageUrl.slice(0, 90)}`);
      return Response.json({
        url: null,
        note: "That photo is not on a plain background — keeping the stand-in.",
      });
    }
    console.info(
      `[cutout] ${cut.keyed ? "keyed" : "kept as it is"} ${imageUrl.slice(0, 70)} — ` +
        `keyed ${cut.keyedRatio.toFixed(2)}, trimmed ${cut.trimmedRatio.toFixed(2)}`
    );
    return Response.json({
      url: cut.url,
      widthRatio: cut.widthRatio,
      keyedRatio: cut.keyedRatio,
      trimmedRatio: cut.trimmedRatio,
      keyed: cut.keyed,
      // said out loud so the room can explain itself rather than just look odd
      note: cut.keyed
        ? undefined
        : "That photo would not come off its background — showing the drawing.",
    });
  } catch {
    return Response.json({ url: null, note: "Could not read that photo." });
  }
}
