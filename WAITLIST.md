# PIXX-AR waitlist — setup

Standalone landing page at `/waitlist`. Nothing in it imports from the PIXX-AR app,
and Clerk middleware skips it, so it can't be broken by auth work.

- landing page: `/waitlist`
- signup api: `POST /api/waitlist`
- your private signup table: `/waitlist/list?key=<WAITLIST_ADMIN_KEY>`
- csv export: `/api/waitlist/export?key=<WAITLIST_ADMIN_KEY>`

## 1. make the supabase project (2 min)

1. supabase.com → new project (free tier). name it `pixx-ar`.
2. wait for it to finish provisioning.
3. **Run `supabase/waitlist.sql` by hand:** dashboard → SQL Editor → New query →
   paste the whole file → Run.
   If you skip this, every signup fails and the server log says:
   `[waitlist] insert failed (404): ... relation "public.waitlist" does not exist`
4. dashboard → Project Settings → API. copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_ROLE_KEY`
     (service_role, not anon — it's server-only and never reaches the browser)

## 2. fill in .env.local

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
WAITLIST_ADMIN_KEY=pick-any-secret-string
```

Restart `npm run dev`, then test at http://localhost:3000/waitlist

## 3. deploy

```
npx vercel          # first run: link/create the project
npx vercel --prod
```

Then add the same three env vars in the Vercel dashboard
(Project → Settings → Environment Variables → Production) and redeploy.
Share `https://<your-vercel-url>/waitlist`.

## 4. showing judges

- `/waitlist/list?key=...` is the live signup table, newest first, with a csv download.
- the landing page footer shows the real live count, so it ticks up as people sign up
  in the room.
- the optional "furnishing" chips are the feedback hook — every signup tells you
  whether they're doing a dorm, an apartment, a first place, or one room.
