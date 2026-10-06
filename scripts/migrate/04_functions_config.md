# 04 — Functions & configuration checklist (manual steps)

Everything here configures the **NEW** project only. Nothing in this list is
automated (Supabase Dashboard / Clerk Dashboard settings aren't fully
scriptable); tick each box and paste evidence into the run log. The OLD
project and the old Vercel deployment stay untouched.

---

## 1. Edge Functions (NEW)

- [ ] `supabase functions deploy sync_google_calendar --project-ref <NEW_PROJECT_REF>`
- [ ] `supabase functions deploy send_signup_reminder --project-ref <NEW_PROJECT_REF>`
- [ ] Function secrets (`supabase secrets set … --project-ref <NEW_PROJECT_REF>`, values never logged):
  - [ ] `SENDGRID_API_KEY`
  - [ ] `SENDGRID_FROM` (verified sender)
  - [ ] `PUBLIC_APP_URL` (used for the email logo URL)
  - [ ] `GOOGLE_CALENDAR_ICS_URL` (the RHS Band public ICS feed)
  - [ ] `CALENDAR_SYNC_SECRET` (long random value for scheduled sync calls)
- [ ] Note: `sync_google_calendar` currently runs with `verify_jwt = false` and
      accepts any signed-in user. Tightening to staff-only is **Phase 3 work**
      (docs/PLATFORM_PLAN.md §6 #4) — known and accepted for the clone window.

## 2. Schedules (cron)

- [ ] On OLD (read-only), inspect existing jobs:
      `psql "$OLD_DB_URL" -c "select jobid, schedule, command from cron.job order by jobid"`
- [ ] On NEW, enable `pg_cron` + `pg_net` if not already (Dashboard → Database → Extensions).
- [ ] Recreate each job, e.g. the calendar sync (secret header set):
      `select cron.schedule('google-calendar-sync', '*/5 * * * *', $$
         select net.http_post(url := 'https://<NEW_PROJECT_REF>.supabase.co/functions/v1/sync_google_calendar',
           headers := jsonb_build_object('x-calendar-sync-secret', '<CALENDAR_SYNC_SECRET>', 'Content-Type', 'application/json'),
           body := '{}');
      $$);`
- [ ] Recreate any `send_signup_reminder` schedule if one existed on OLD (check `cron.job` output above).

## 3. Auth configuration — legacy (kept for the faithful-clone window)

Phase 1 is a faithful clone, so Supabase Auth stays configured so the ported
security suite and smoke tests behave exactly like live. **At cutover, Clerk is
the auth system** (section 4) and these settings matter only for the legacy
window and rollback safety.

- [ ] Site URL: the new production URL (Vercel) + `http://localhost:5173` for dev.
- [ ] Redirect URLs: `<app>/update-password` (password-reset landing), `<app>/*`.
- [ ] SMTP: custom SMTP (SendGrid) per `docs/email-setup.md` in the OLD repo
      (SMTP host/port/user + password go in Dashboard → Auth → SMTP; never in git).
- [ ] Email templates: copy the 6 from `supabase/templates/` (confirmation,
      recovery, invite, magic_link, email_change, reauthentication) into
      Dashboard → Auth → Email Templates (subjects + HTML).
- [ ] Confirm email ON (as configured on OLD), and verify one test signup +
      one test password reset end to end.

## 4. Auth configuration — Clerk + Supabase Third-Party Auth (the real one)

Per docs/PLATFORM_PLAN.md §13. Verify each step with a real sign-in.

- [x] Clerk **development** instance exists: `https://precise-cod-8390.clerk.accounts.dev`
      (used for the `03b_clerk_import.sh --apply --limit 2` hash spike; its
      `sk_test_…` key goes in `.env` as `CLERK_SECRET_KEY` for that run).
- [ ] Create the Clerk application **production** instance (different domain +
      `sk_live_…` key) and use it for the real import and cutover.
- [ ] Clerk → **Connect with Supabase** (sets the `role: authenticated` session
      claim + compatible token shape). If configuring manually: add the `role`
      claim to session tokens with value `authenticated`.
- [ ] Session-token custom claim for legacy IDs:
      `{ "userId": "{{user.external_id || user.id}}" }` (Clerk → Sessions →
      Customize session token).
- [ ] Supabase Dashboard → Authentication → **Third-Party Auth** → add Clerk
      (dev: `precise-cod-8390.clerk.accounts.dev`; production: the production
      instance domain). Local dev: `[auth.third_party.clerk]` with
      `enabled = true` and the Clerk domain in `supabase/config.toml`.
- [ ] Clerk webhook: `user.created` → `https://<NEW_PROJECT_REF>.supabase.co/functions/v1/clerk_user_created`
      (built in Phase 3b) with the svix signing secret stored as a function
      secret. Join-code gate lives here (§13.2).
- [ ] Frontend env (Vercel + local `.env` for the app): `VITE_CLERK_PUBLISHABLE_KEY`,
      `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (from the NEW project).
- [ ] Import users with `03b_clerk_import.sh` (spike first!), then sign in with
      2–3 real accounts and their **existing** passwords before cutover.
- [ ] Verify: forgot-password email arrives and lands on `/update-password`;
      a wrong join code cannot get a profile; a director invite +
      forced-password-change still works.

## 5. Vercel & PWA (old deployment untouched)

- [ ] New Vercel project for the new app (don't touch `rhs-band.vercel.app`).
- [ ] When the new frontend deploys (Phase 3b/4): bump the service-worker cache
      name so installed PWAs refresh cleanly at cutover.
- [ ] Smoke test the installed PWA on a phone after the env swap.

## 6. Rollback readiness

- [ ] OLD project + old Vercel deployment confirmed unchanged and healthy.
- [ ] `.env` in a safe place (gitignored — back it up to a password manager, not git).
- [ ] `scripts/migrate/out/` dumps retained until the post-cutover monitoring
      checklist completes (they contain password hashes — keep them private).
- [ ] Rotate the Supabase **personal access token** used for this migration
      (it transited chat) once the pipeline is finished.
