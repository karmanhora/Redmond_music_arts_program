# Third-Party Providers & What They May Process (DRAFT)

> **DRAFT.** Statements about providers are taken from their published materials
> and were **not** independently audited. Confirm current terms before relying on
> them.

| Provider | Role | Data it may process | Notes |
|---|---|---|---|
| **Supabase** | Database, Auth, Edge Functions, transactional email | all student/staff data described in the inventory; email for auth | SOC 2 Type 2, ISO 27001 per vendor; AES-256 at rest / TLS in transit (vendor claim); data lives in the project's chosen AWS region; **backups are plan-dependent** (Free has none) |
| **Vercel** | Static hosting + edge/CDN | request metadata; **no student records by design** (static SPA) | SOC 2 Type 2 / ISO 27001 per vendor; runtime logs can contain request paths/params — keep PII out of URLs where possible; Hobby log retention is short |
| **Email/SMTP provider** (Supabase built-in, or SendGrid/etc.) | Auth & invitation email | recipient email | built-in sender is rate-limited and not for production; **currently unconfigured** |
| **Google** | Optional sign-in (OAuth) | basic profile + email, if the user chooses Google sign-in | no Calendar API scopes; the calendar feature uses a **public ICS feed**, not the user's Google account |
| **GitHub** | Source code hosting | **none** (code only; no student data) | ensure no secrets are committed |

## Subprocessors
Supabase uses AWS for hosting; both publish subprocessor lists in their DPA/Trust
Center. Retrieve the current lists for the district packet. *(Names not verified
here.)*

## What the district will likely ask for
- A DPA / SOC 2 report from Supabase and Vercel.
- Confirmation of the Supabase **region** and whether data leaves it.
- Whether the SMTP provider is the Supabase built-in sender or a named provider.
- A short statement that no advertising/analytics providers are used.
