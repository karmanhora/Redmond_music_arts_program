# 04 — Functions & configuration checklist (manual steps)

Everything here configures the **NEW** project only. Nothing in this list is
automated (Supabase dashboard settings aren't fully scriptable); tick each box
and paste evidence into the run log. The OLD project and the old Vercel
deployment stay untouched.

---

## 1. Edge Functions (NEW)

- [ ] `supabase functions deploy sync_google_calendar --project-ref <NEW_PROJECT_REF>`
- [ ] `supabase functions deploy send_signup_reminder --project-ref <NEW_PROJECT_REF>`
- [ ] Function secrets (`supabase secrets set … --project-ref <NEW_PROJECT_REF>`, values never logged):
  - [ ] `SENDGRID_API_KEY`
  - [ ] `SENDGRID_FROM` (verified sender)
  - [ ] `PUBLIC_APP_URL` (only for the reference `send_signup_reminder` function,
        which builds an image URL from it; this app's own auth emails in
        `supabase/templates/` contain no images, so nothing else reads it)
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

## 3. Auth configuration — Supabase Auth

**Supabase Auth is the app's sign-in system** (migration 021): it owns accounts and
sessions, and the JWT it issues is what every RLS policy resolves identity from.
These settings are live configuration, not a legacy fallback. Section 4 is the
cutover checklist.

- [ ] Site URL: the new production URL (Vercel) + `http://localhost:5173` for dev.
- [ ] Redirect URLs: `<app>/reset-password` (the password-recovery landing — see
      the `redirectTo` in `src/hooks/useAuth.tsx`), plus `<app>/*`.
- [ ] SMTP: custom SMTP (SendGrid) per `docs/email-setup.md` in the OLD repo
      (SMTP host/port/user + password go in Dashboard → Auth → SMTP; never in git).
- [ ] Email templates: copy the 6 from `supabase/templates/` (confirmation,
      recovery, invite, magic_link, email_change, reauthentication) into
      Dashboard → Auth → Email Templates (subjects + HTML).
- [ ] Confirm email ON (as configured on OLD), and verify one test signup +
      one test password reset end to end.

## 4. Auth configuration — cutover checklist

Verify each step with a real sign-in against the NEW project.

- [ ] Authentication → Providers → **Email** enabled, **Confirm email ON** (as
      configured on OLD). The app's sign-up shows "check your email" when a
      confirmation is required, and sign-in refuses an unconfirmed account with a
      resend action.
- [ ] Authentication → URL Configuration → **Site URL**: the production Vercel
      origin, and `http://localhost:5173` for dev.
- [ ] Authentication → URL Configuration → **Redirect URLs**: the production
      origin, the dev origin, and `<origin>/reset-password` on both — a recovery
      link lands there (`redirectTo` in `src/hooks/useAuth.tsx`) and the app
      refuses to apply one without a session.
- [ ] **No `auth.users` signup trigger is deployed, deliberately.** The join code
      is validated in the app by `join_program()` (migration 020) *after* the
      account exists, which is the only flow that can also add somebody's second
      program. `handle_new_user` stays retired (018) and 021 does not bring it
      back.
- [ ] Frontend env (Vercel + local `.env.local`): `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY` from the NEW project. There is no auth-provider
      variable any more.
- [ ] Verify end to end: sign in; a refresh keeps the session; sign out clears it;
      a wrong join code cannot get a profile; the forgot-password email arrives
      and lands on `/reset-password` with a working new-password form.

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
