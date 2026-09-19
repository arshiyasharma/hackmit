import { addSignup, countSignups } from "@/lib/waitlist-db";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET() {
  try {
    return Response.json({ total: await countSignups() });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "count unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { email?: unknown; furnishing?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "that didn't come through — try again?" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: "that email looks off — mind checking it?" }, { status: 400 });
  }

  const furnishing =
    typeof body.furnishing === "string" && body.furnishing.length <= 40
      ? body.furnishing
      : null;

  try {
    const { position, total, alreadyIn } = await addSignup({ email, furnishing });
    return Response.json({ position, total, alreadyIn });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "something broke on our end — try once more?" },
      { status: 500 },
    );
  }
}
