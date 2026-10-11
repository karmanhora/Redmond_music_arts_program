# Auth email setup (the emails Supabase sends)

Sign-in is Supabase Auth (`docs/AUTH_MIGRATION.md`), so **Supabase sends every
account email in this app** — confirmation, password reset, invite, magic link,
email change, reauthentication, and enabled security notifications. Their
wording and layout live in `supabase/templates/`, wired up by
`supabase/config.toml`.

There is no email provider to integrate and no sending code in this repository.
That is the point: nothing here can leak a key, and nothing has to be redeployed
when a subject line changes.

---

## 1. Which email fires when

| Email | Fires when | Template | The action it carries |
| --- | --- | --- | --- |
| Confirmation | Someone signs up (`supabase.auth.signUp`), or asks for the link again from the sign-in screen | `confirmation.html` | `{{ .ConfirmationURL }}`, with `{{ .Token }}` as the typed fallback |
| Recovery | Someone taps **Forgot your password?** (`resetPasswordForEmail`) | `recovery.html` | `{{ .ConfirmationURL }}` → lands on `/reset-password`; `{{ .Token }}` fallback |
| Invite | An administrator invites an address (`auth.admin.inviteUserByEmail`) | `invite.html` | `{{ .ConfirmationURL }}`; `{{ .Token }}` fallback |
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

The project currently sends through Supabase's built-in sender. It is for
testing: it is rate-limited to a handful of messages per hour, and it is not
built for deliverability.

That matters more here than in most apps, because **a new account cannot sign in
until it confirms its address**. A class signing up together will exhaust the
limit, the confirmations will not arrive, and the app will look broken.

Fix it in Authentication → Emails → SMTP Settings (or the commented
`[auth.email.smtp]` block in `supabase/config.toml`): host, port, user, password
and a from-address on a domain you control. Then verify the DNS records the
provider asks for — without them, mail is sent but lands in spam.

**No application code changes when SMTP is configured.** The templates, the
subjects, the redirect URLs and every call in `src/hooks/useAuth.tsx` stay
exactly as they are; only the transport changes.

The previous version of this app used **SendGrid**, so that is the continuity
option if an account and a verified sender domain already exist. Any provider
works — what matters is that the from-address domain is verified, or the mail is
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
stays in-app. Emailing those (a new event, a check-in opening) needs a separate
transactional provider and a sending function this project has deliberately not
added yet. If that becomes a requirement, the decision to make first is which
provider, because it is a second vendor with its own key, its own verified
domain and its own cost.

## 7. Never

Put a key, token, SMTP password, sender credential or tracking pixel in a
template or in this document. Templates are content; credentials belong in
Authentication → Emails → SMTP Settings, where they are stored encrypted and are
never returned.
