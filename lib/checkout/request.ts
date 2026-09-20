/** Request guards shared by the checkout and Visa routes. */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Browser writes must originate from this application. Non-browser clients may omit Origin. */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== new URL(request.url).origin)) {
    return Response.json({ error: "Open checkout in this app to continue." }, {
      status: 403, headers: { "Cache-Control": "no-store" },
    });
  }
  return null;
}

const COOKIE = "pixx_checkout";
const ID = /^[a-f0-9-]{36}$/;

/** An opaque, server-created guest session; never exposed in response JSON. */
export function checkoutOwner(request: Request): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return cookie && ID.test(cookie) ? cookie : null;
}

export function ownerCookie(request: Request, ownerId: string): string {
  return `${COOKIE}=${ownerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
