/**
 * Waitlist storage — Supabase over plain REST (PostgREST), no SDK.
 *
 * Standalone on purpose: nothing here imports from the PIXX-AR app, and nothing
 * in the PIXX-AR app should import from here. Server-only — the service role key
 * must never reach the browser.
 */

const URL_ENV = "SUPABASE_URL";
const KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

export type WaitlistRow = {
  id: number;
  email: string;
  furnishing: string | null;
  created_at: string;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Loud on purpose: a missing key should break the request, not silently
    // drop a signup we can never recover.
    throw new Error(
      `[waitlist] ${name} is not set. Add it to .env.local (and to the Vercel project env) — see supabase/waitlist.sql`,
    );
  }
  return value;
}

function headers() {
  const key = env(KEY_ENV);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function endpoint(path: string) {
  return `${env(URL_ENV).replace(/\/$/, "")}/rest/v1/${path}`;
}

/**
 * Inserts a signup. Returns their place in line plus how many people are on the
 * list. Place is a real rank (rows at or before them), not the row id — ids gap
 * whenever a duplicate is rejected or a row is removed.
 */
export async function addSignup(input: {
  email: string;
  furnishing: string | null;
}): Promise<{ position: number; total: number; alreadyIn: boolean }> {
  const res = await fetch(endpoint("waitlist"), {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify([{ email: input.email, furnishing: input.furnishing }]),
    cache: "no-store",
  });

  // 23505 = unique violation: they already signed up. Treat as success.
  if (res.status === 409) {
    const existing = await getByEmail(input.email);
    if (!existing) throw new Error("[waitlist] duplicate email but no row found");
    return {
      position: await rankOf(existing.id),
      total: await countSignups(),
      alreadyIn: true,
    };
  }

  if (!res.ok) {
    throw new Error(`[waitlist] insert failed (${res.status}): ${await res.text()}`);
  }

  const [row] = (await res.json()) as WaitlistRow[];
  return { position: await rankOf(row.id), total: await countSignups(), alreadyIn: false };
}

/** How many people are at or ahead of this row — their actual place in line. */
async function rankOf(id: number): Promise<number> {
  const res = await fetch(endpoint(`waitlist?select=id&id=lte.${id}`), {
    headers: { ...headers(), Prefer: "count=exact", Range: "0-0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[waitlist] rank failed (${res.status})`);
  const total = res.headers.get("content-range")?.split("/")[1];
  return total ? Number(total) : 1;
}

async function getByEmail(email: string): Promise<WaitlistRow | null> {
  const res = await fetch(
    endpoint(`waitlist?email=eq.${encodeURIComponent(email)}&select=*&limit=1`),
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`[waitlist] lookup failed (${res.status})`);
  const rows = (await res.json()) as WaitlistRow[];
  return rows[0] ?? null;
}

export async function countSignups(): Promise<number> {
  const res = await fetch(endpoint("waitlist?select=id"), {
    headers: { ...headers(), Prefer: "count=exact", Range: "0-0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[waitlist] count failed (${res.status})`);
  // content-range looks like "0-0/42"
  const total = res.headers.get("content-range")?.split("/")[1];
  return total ? Number(total) : 0;
}

export async function listSignups(): Promise<WaitlistRow[]> {
  const res = await fetch(
    endpoint("waitlist?select=*&order=created_at.desc&limit=1000"),
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`[waitlist] list failed (${res.status})`);
  return (await res.json()) as WaitlistRow[];
}
