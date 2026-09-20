import { listSignups } from "@/lib/waitlist-db";

export const dynamic = "force-dynamic";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function WaitlistAdmin({ searchParams }: PageProps<"/waitlist/list">) {
  const adminKey = process.env.WAITLIST_ADMIN_KEY;
  if (!adminKey) {
    throw new Error(
      "[waitlist] WAITLIST_ADMIN_KEY is not set — add it to .env.local and to the Vercel env",
    );
  }

  const raw = (await searchParams).key;
  const key = Array.isArray(raw) ? undefined : raw;
  if (key !== adminKey) {
    return (
      <div className="wl-root">
        <div className="wl-admin">
          <p className="wl-empty">nope — this page needs the right ?key=</p>
        </div>
      </div>
    );
  }

  const rows = await listSignups();

  return (
    <div className="wl-root">
      <div className="wl-admin">
        <div className="wl-admin-top">
          <h1>
            PIXX-AR waitlist · {rows.length} {rows.length === 1 ? "signup" : "signups"}
          </h1>
          <a href={`/api/waitlist/export?key=${encodeURIComponent(key ?? "")}`}>
            download csv ↓
          </a>
        </div>

        {rows.length === 0 ? (
          <p className="wl-empty">no signups yet — the table is live and waiting.</p>
        ) : (
          <table className="wl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>email</th>
                <th>furnishing</th>
                <th>signed up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td className="wl-email">{row.email}</td>
                  <td>{row.furnishing ?? "—"}</td>
                  <td>{when(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
