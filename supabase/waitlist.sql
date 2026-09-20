-- PIXX-AR waitlist table.
-- RUN THIS FILE BY HAND: Supabase dashboard -> SQL Editor -> paste -> Run.
-- If you skip it, every signup fails with a 404 from /api/waitlist and the
-- server log says: [waitlist] insert failed (404): ...relation "public.waitlist" does not exist

create table if not exists public.waitlist (
  id          bigint generated always as identity primary key,
  email       text not null,
  furnishing  text,
  created_at  timestamptz not null default now()
);

-- one row per person; the API turns the conflict into a friendly "you're already in"
create unique index if not exists waitlist_email_key
  on public.waitlist (lower(email));

-- Locked down: only the server's service-role key can read or write.
-- (Service role bypasses RLS, so enabling it with no policies is the goal.)
alter table public.waitlist enable row level security;

-- Handy view for eyeballing signups in the Table Editor.
comment on table public.waitlist is 'PIXX-AR waitlist signups';
