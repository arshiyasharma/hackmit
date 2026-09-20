import { redirect } from "next/navigation";

import Capture from "@/components/Capture";

/**
 * The front door is the landing page now, and the product lives in its third
 * room — so the site's root walks there instead of opening the camera on its
 * own. (`/landing?product` lands straight inside room III with the product open.)
 *
 * `/?standalone=1` still renders the capture screen by itself: the fallback for
 * a machine that cannot run the landing's WebGL stage, and the quick way in for
 * whoever is working on the product. lib/nav.tsx sends the standalone screens
 * here, so that path stays a closed loop. `/room` and `/checkout` are untouched.
 */
export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  if (params.standalone !== undefined) return <Capture />;

  // carry the expo switches (`?demo=1`, `?xrsim=1`) across the redirect
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }
  // /auth/callback sends a failed sign-in to `/?error=auth`: back to the door
  // of room III, where the sign-in screen says what happened
  if (params.error === "auth") query.set("product", "");
  const qs = query.toString().replace(/=(&|$)/g, "$1");
  redirect(qs ? `/landing?${qs}` : "/landing");
}
