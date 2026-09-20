import { listSignups } from "@/lib/waitlist-db";

export const dynamic = "force-dynamic";

function cell(value: string | null) {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const adminKey = process.env.WAITLIST_ADMIN_KEY;
  if (!adminKey) {
    throw new Error("[waitlist] WAITLIST_ADMIN_KEY is not set — the export route is unusable");
  }
  const { searchParams } = new URL(request.url);
  if (searchParams.get("key") !== adminKey) {
    return new Response("nope", { status: 401 });
  }

  const rows = await listSignups();
  const csv = [
    "id,email,furnishing,signed_up_at",
    ...rows.map((r) => [r.id, cell(r.email), cell(r.furnishing), r.created_at].join(",")),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="pixx-ar-waitlist.csv"',
    },
  });
}
