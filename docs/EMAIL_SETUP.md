# Auth email setup (the emails Supabase sends)

Sign-in is Supabase Auth (`docs/AUTH_MIGRATION.md`), so **Supabase sends every
account email in this app** — confirmation, password reset, invite, magic link,
email change, reauthentication, and enabled security notifications. Their
wording and layout live in `supabase/templates/`, wired up by
`supabase/config.toml`.

Supabase Auth handles email delivery; the app's server-side Edge Function only
requests student invitations and never exposes its service-role key to the
browser. There is no third-party email transport to integrate, and changing a
subject line or template does not require a frontend redeploy.

The program-staff invite flow is backed by migration
`supabase/migrations/027_program_email_invites.sql` and the
`invite-student` Edge Function. Apply the migration and deploy the function
before enabling the invitation form in a production frontend; see
`scripts/migrate/04_functions_config.md`.

---

## 1. Which email fires when

| Email | Fires when | Template | The action it carries |
| --- | --- | --- | --- |
| Confirmation | Someone signs up (`supabase.auth.signUp`), or asks for the link again from the sign-in screen | `confirmation.html` | `{{ .ConfirmationURL }}`, with `{{ .Token }}` as the typed fallback |
| Recovery | Someone taps **Forgot your password?** (`resetPasswordForEmail`) | `recovery.html` | `{{ .ConfirmationURL }}` → lands on `/reset-password`; `{{ .Token }}` fallback |
| Invite | Program staff invite a new student from the roster (`auth.admin.inviteUserByEmail`) | `invite.html` | `{{ .ConfirmationURL }}`; accepting and confirming the invite adds the student to that program |
| Magic link | A passwordless sign-in is requested (`signInWithOtp`) | `magic_link.html` | `{{ .ConfirmationURL }}`; `{{ .Token }}` fallback |
| Email change | The address on an account is changed | `email_change.html` | `{{ .ConfirmationURL }}`, naming `{{ .Email }}` and `{{ .NewEmail }}` |
| Reauthentication | A security-sensitive change asks the person to prove themselves again | `reauthentication.html` | `{{ .Token }}` only — a code, not a link |
| Password changed notification | A user's password changes | `password_changed_notification.html` | `{{ .Email }}` and `{{ .SiteURL }}`; enable the notification in Supabase Auth |

Security notifications are separate from the password-reset email and must be
enabled in the Supabase project before they are sent. The password-changed
notification is enabled in this repository's `supabase/config.toml`. Only the
variables in the table above are used; they are documented Supabase variables.

## 2. Applying them

Templates are not deployed by the frontend build — they are configuration. Two
honest routes, and either works:

**CLI (preferred, because it is version-controlled).**

```bash
supabase link --project-ref <PROJECT_REF>
supabase config push --project-ref <PROJECT_REF>
```

`config push` **replaces** the project's auth configuration with
`supabase/config.toml`. If a `config.toml` already exists for this project
elsewhere, merge the `[auth]` sections into it first — do not overwrite it, or
settings that only exist in the dashboard copy are reset.

**Dashboard.** Authentication → Emails → Templates: paste the subject from
`supabase/config.toml` and the contents of the matching file. For the password
change notification, enable **Password changed** in the project's Auth
notification settings, then set its subject and paste
`supabase/templates/password_changed_notification.html` in the notification
template editor. Notification enablement is project-level; saving the template
alone does not turn it on. This dashboard setup drifts from the repository the
next time somebody edits a template here — which is the argument for the CLI
route.

If preview and production are separate Supabase projects, apply this to **both**.
They are separate environments; an email template is not inherited.

## 3. SMTP, and the one thing that will bite you

This project sends through **Brevo's SMTP relay**, not Supabase's built-in
sender: host `smtp-relay.brevo.com`, port `587`, user the **SMTP login** Brevo
shows on its SMTP page (often `<id>@smtp-brevo.com`, not the account email), and
an **SMTP key** as the password — not an API key. All of it lives in
**Authentication → Emails → SMTP Settings**, which is dashboard state only: the
`[auth.email.smtp]` block in `supabase/config.toml` is still commented out, so a
`supabase config push` would silently replace it. Know that before running one.

The **From** address has to be one Brevo has verified under *Senders* — anything
else is refused at the relay, whatever the templates say.

What a student sees when any part of that transport fails is the same sentence
on the phone: **Create account** answers `Error sending confirmation email`, and
**Forgot your password?** fails the same way, because both go through the same
relay. The app maps it to plain language in `src/hooks/useAuth.tsx` (before that
it was shown verbatim, which reads like the student's mistake), but the sentence
cannot tell you *why*. The auth log can, and it always carries the transport's
own answer under `error`. Two real examples from this project:

```
# 2026-10-16 — SendGrid account out of credits (trial ended, no free plan since May 2025)
path: /signup    status: 500   error_code: unexpected_failure
error: 451 "Authentication failed: Maximum credits exceeded"

# 2026-10-17 — the same request after moving the relay to Brevo
path: /recover   status: 200   (no `error` field at all)
```

So read the log before touching anything. `451` with "Maximum credits exceeded"
is the provider refusing on billing, not a bad password; `535` is credentials; a
`550` naming the sender is an unverified From address. None of those is a code
bug, and all three are one identical sentence on the student's phone.

The SendGrid entries above are history, not a fallback: its trial expired and
Supabase Auth does **not** fall back to its own sender when a custom relay
refuses — it fails the request. Going back means paying for a plan that sends
far more mail than this app ever will.

**If SMTP is ever cleared**, Supabase's built-in sender takes over and it is not
a spare tyre: since September 2024 it **only delivers to addresses that belong to
the project's own Supabase organization** — the Supabase team, not the school
domain ([changelog](https://github.com/orgs/supabase/discussions/29370)). Every
student address would then be refused, no matter how quiet the hour is.

**The one route that needs no email:** *Continue with Google*. The school
addresses are Google Workspace accounts, the Google provider is enabled, and
OAuth accounts arrive already confirmed — a student can get in that way while a
transport problem is being sorted. That is a workaround, not the fix:
email/password sign-up and password reset stay broken for everyone until mail
actually leaves.

That matters more here than in most apps, because **a new account cannot sign in
until it confirms its address**. Even with a working transport, a class signing
up together can exhaust a per-hour rate limit, and the confirmations will not
arrive.

To configure a transport — the first time, or to replace one — use
Authentication → Emails → SMTP Settings (or the commented `[auth.email.smtp]`
block in `supabase/config.toml`): host, port, user, password and the from-address
the provider has verified. Then authenticate the domain with the provider and
verify the DNS records it asks for — without them, mail is sent but lands in
spam. A verified *single address* (Brevo *Senders*, SendGrid *Single Sender
Verification*) is enough to start; only a domain lifts the spam-folder risk.

If an invitation fails with “Error sending invite email,” check that the exact
From address configured in Supabase Auth is verified at the provider before
retrying — that message is the `invite-student` function, which sends through
its own transport (`SENDGRID_API_KEY`, see §6a), not through the auth relay.

**No application code changes when SMTP is configured.** The templates, the
subjects, the redirect URLs and every call in `src/hooks/useAuth.tsx` stay
exactly as they are; only the transport changes. A failed send is a transport
problem until the auth log says otherwise — start there, not in `src/`.

**Two transports, not one.** Auth mail goes through Brevo's relay (this
section); the event digest and the invite function call SendGrid's **API** with
`SENDGRID_API_KEY` (§6a). They are unrelated: changing the relay does not touch
them, and a SendGrid outage does not stop sign-ups. Any provider works for the
relay — what matters is that the from-address is verified there, or the mail is
filtered.

## 4. Redirect URLs

Authentication → URL Configuration:

- **Site URL** — the production origin.
- **Redirect URLs** — that origin, **`<origin>/reset-password`**, and
  `http://localhost:5173/**` for development.

A destination that is missing from that list is silently rewritten to the Site
URL, which opens the home page instead of the reset form and looks like the link
was broken. `docs/AUTH_MIGRATION.md` §3 has the same checklist next to the
migration that depends on it.

## 5. Testing it honestly

- **Locally:** `supabase start` runs a mail catcher alongside the local stack.
  Open the local mailbox (port 54324) and you can read every message the local
  project sends without touching a real inbox.
- **In production:** sign up with an address you control, open the confirmation,
  then run the password-reset flow end to end. Check it **arrives in the inbox**
  — not just in spam — because that is what a student will experience. Also check
  the link opens `/reset-password`, not the home page (§4), and verify that a
  successful password change sends the password-changed notification.
- A confirmation that arrives but whose link does nothing is almost always a
  redirect-URL problem, not a template one. A missing subject line means the
  template was saved without its subject.

## 6. What this does not cover

The in-app notification bell — the `notifications` table and its SQL triggers —
stays in-app. §6a covers the one app email that leaves it. Emailing the bell's
*other* trigger (a check-in opening) is still not built: a check-in is live for
minutes, so it belongs in the bell, not in a mailbox.

## 6a. App email: the upcoming-events digest

This app now sends one email of its own (migration 032 + the `event-digest` edge
function): at most one a day per person, listing the next week's events across
every program they belong to. It goes through SendGrid's **API**, with its own
key and sender — that is a *different* transport from the auth relay in §3, so
the day it is switched on it is a second vendor, not a free rider on Brevo.

- **Who is owed one** — `public.due_event_digests()` returns the members who are
  active, subscribed, have a confirmed address, are not deactivated, and have at
  least one event in the window with no delivery logged for today. Nobody else:
  an opted-out member, an unconfirmed address and a quiet program all produce no
  row. It returns email addresses, so it is **service-role only** and no client
  can call it.
- **Not sending twice** — `public.record_event_digests()` logs the run against
  (member, program, day). A retried or overlapping job is therefore a no-op.
  A send that *fails* is deliberately not logged, so the next run offers that
  person again rather than dropping them silently.
- **Turning it off** — Account settings → Preferences → *Upcoming events by
  email*, one switch per program (`set_email_upcoming_events()`). A student in
  band and orchestra can quiet one without losing the other. The in-app bell is
  unaffected either way.
- **Seeing who it reaches** — Roster → *Upcoming-events email*, for staff of
  that program only: how many active members the email can reach, and the reason
  each of the rest is skipped (`digest_reachability()`, migration 033). It
  reports the *state* of an address — confirmed, unconfirmed, absent — and never
  the address itself. "Reachable" and "will get an email this week" are different
  questions, and the card says which one it is answering: a quiet week, an
  archived program and a program nobody can be reached in all read differently.
- **Secrets** — `EVENT_DIGEST_SECRET` (the cron job sends it as
  `x-event-digest-secret`; without it set the function refuses to run), plus
  `SENDGRID_API_KEY` and `SENDGRID_FROM`, and optionally `DIGEST_FROM_NAME` and
  `PUBLIC_APP_URL`. These are SendGrid **API** credentials for
  `api.sendgrid.com`, *not* the SMTP host/user/password above — those live in
  Dashboard → Auth → SMTP. Nothing has set them yet: `supabase secrets list`
  showed only the platform's own variables on 2026-10-11 and again on
  2026-10-17, so this is the first thing to create before the digest can send
  anything.
- **The schedule** — a Supabase Cron job, like the calendar sync. The exact
  statement is in `scripts/migrate/04_functions_config.md` §2. `pg_cron` and
  `pg_net` are not installed on the live project yet, so the job cannot be
  created until they are enabled (Dashboard → Database → Extensions).
- **Current state (2026-10-11)** — migration 032 is applied and the
  `event-digest` function is deployed (`verify_jwt = false`, authorised by
  `x-event-digest-secret`). Without that secret set the deployed function
  answers `401` to every caller, so nothing is mailed to anyone yet.
- **Testing it honestly** — call it with `{"dry_run": true}` and the
  `x-event-digest-secret` header: the JSON names every recipient, subject and
  event and sends nothing. A service-role bearer is not a substitute — the
  deployed function rejects one with `401`.
  `node scripts/dev/check_event_digest.mjs` checks the sender's logic locally
  with no network at all.

## 7. Never

Put a key, token, SMTP password, sender credential or tracking pixel in a
template or in this document. Templates are content; credentials belong in
Authentication → Emails → SMTP Settings, where they are stored encrypted and are
never returned.
