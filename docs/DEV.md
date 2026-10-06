# Development guide (RHS Band)

Everything a developer needs to run, change and verify this app. The master plan
is [`docs/PLATFORM_PLAN.md`](PLATFORM_PLAN.md); the manual dashboard steps that
automate nothing are in
[`scripts/migrate/04_functions_config.md`](../scripts/migrate/04_functions_config.md).

The site is the **Redmond High School Music and Arts Program**: one place holding
each music program's attendance tracker. The database calls a program an
`ensemble`; the interface never does — it says **program**, and "band" only where
the program on screen is the band. Band is currently the only program that
exists, but nothing in the code assumes it is the only one.

---

## 1. What is in here

| Path | What it is |
| --- | --- |
| `src/` | The web app: Vite + React 19 + TypeScript + Tailwind v4 |
| `supabase/migrations/007`–`020` | The multi-program schema, policies, RPCs, calendar sync, join flow |
| `supabase/functions/` | Edge Functions — `clerk_user_created` (the signup webhook) |
| `supabase/tests/` | SQL suites (backfill, isolation, security, join) run inside transactions |
| `scripts/migrate/` | The clone pipeline: dump OLD → restore → migrate → verify |
| `docs/` | This file and the platform plan |
| `reference/RHS-BAND/` | Read-only clone of the old app, for conventions only |
| `.tools/pgsql/bin` | Portable PostgreSQL 18 client used by the migration scripts (gitignored) |

## 2. Run the app

Requires Node 22+ (built on v22.23.2, npm 12).

```bash
npm install
cp .env.example .env.local     # then fill in the three values below
npm run dev                    # http://localhost:5173
```

`.env.local` is gitignored and is the only file the web app reads:

| Variable | Where to get it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API (the **NEW** project) |
| `VITE_SUPABASE_ANON_KEY` | Same page, the `anon` / publishable key |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API keys → Publishable key |

Vite reads env files **once at startup** — restart `npm run dev` after editing.
If a variable is missing the app renders a screen naming exactly what is absent
instead of a blank page (`src/screens/ConfigMissingScreen.tsx`).

Checks:

```bash
npm run typecheck      # tsc -b --noEmit
npm run build          # typecheck + production bundle
npm run preview        # serve the built bundle
```

## 3. Authentication (Clerk is the only auth system)

There is no Supabase login any more. The flow:

1. Clerk signs the person in (its own UI, themed with the band colours).
2. The browser mints a fresh Clerk session token and sends it as the Supabase
   bearer token — that is the whole of the "Clerk as a Supabase Third-Party Auth
   provider" wiring (`src/lib/supabase.ts`, `src/App.tsx` → `ClerkSupabaseBridge`).
   Supabase verifies it and the request runs as the `authenticated` role with
   `sub` = the Clerk user id.
3. `profiles.clerk_id` is how a Clerk account maps to a person. Everything else
   (roles, section) lives on `memberships`, per program.
4. No session is ever stored in the browser (`persistSession: false`); a failed
   token fetch degrades to `anon`, whose policies grant nothing.

The Clerk↔Supabase setup (role claim, third-party provider, session-token claim,
webhook) is checklist §4 of
[`scripts/migrate/04_functions_config.md`](../scripts/migrate/04_functions_config.md).
Without it every request lands as `anon` and the app looks empty.

**Roster gate.** A signed-in Clerk account with no `profiles` row lands on the
join screen (`src/screens/JoinProgramScreen.tsx`, rendered standalone) and picks
which program to join. The **join code** is the only door, and it is validated
server-side — never in the browser:

```
/join  ──►  RPC  join_program(slug, code)      ◄── the path people actually use
                   │  validate_join_code()   (rate-limited: 5 failures / 2 min per IP)
                   ├─ profiles       : created on somebody's first program
                   └─ memberships    : one row per program they join

Clerk  user.created  ──►  Edge Function  clerk_user_created   ◄── pre-provisioning
                                └─ register_signup()  (service-role only)
```

Joining a *second* program is the same screen, reached from the program switcher
or Profile — which is the whole reason the RPC exists: Clerk fires `user.created`
once per account, so the webhook could never add orchestra to somebody who
already signed up for band.

Directors read and rotate the code on the Roster screen (`get_join_code` /
`set_join_code`); `list_active_programs()` gives the join screen real program
names without ever returning a code. Removing somebody is a director's decision:
re-entering a code cannot undo it (`guard_membership_change` refuses, and
`join_program` says so plainly).

## 4. Database

Work on the **NEW** project (`sjiswrvhrnrxkrfhfjrp`). The old project and the old
Vercel deployment are read-only, forever.

The migration scripts read the server-side `.env` (gitignored — never commit it,
never paste its values into a chat or a log):

| Variable | Used by |
| --- | --- |
| `OLD_DB_URL` | `01_dump.sh`, `05_verify.sh` (SELECTs only) |
| `NEW_DB_URL` | everything that writes |
| `NEW_SUPABASE_URL`, `NEW_SUPABASE_ANON_KEY` | row-count and RLS checks |
| `CLERK_SECRET_KEY` | `03b_clerk_import.sh` (hash-preserving user import) |
| `SUPABASE_ACCESS_TOKEN` | CLI/API calls |

Writes are gated: `confirm_target_new` refuses to run unless `CONFIRM_TARGET=NEW`
is set, so a stray invocation cannot touch the live project.

```bash
bash scripts/migrate/06_apply_migrations.sh --dry-run --with-tests   # rehearse
CONFIRM_TARGET=NEW bash scripts/migrate/06_apply_migrations.sh       # apply
bash scripts/migrate/05_verify.sh                                    # clone vs OLD + every suite
```

`--dry-run` loads the migrations and every test in `supabase/tests/` into one
transaction and rolls it back; `--with-tests` also runs the suites (each in its
own savepoint, each rolling itself back). Migration 019 must be applied for the
home and profile screens' attendance ring to answer (`my_attendance_pct()` and
`my_attendance_trend()`); 020 must be applied for `/join` to work
(`join_program()` and `list_active_programs()`).

## 5. How the frontend is put together

```
src/lib/queries.ts   the few table reads (RLS-scoped: profiles, events, attendance…)
src/lib/rpc.ts       every write, plus analytics — all SECURITY DEFINER RPCs
src/lib/types.ts     row + RPC shapes; roles live on memberships, never on profiles
src/hooks/usePrograms.tsx  who am I, which programs am I in, which one is on screen
src/components/ui.tsx  the UI kit: buttons, cards, sheets, toasts, progress ring
src/components/AppShell.tsx      umbrella app bar, bottom nav, program switcher
src/screens/         one file per route (see src/App.tsx for the route table)
```

The session hook is the heart of it: `usePrograms()` holds **every** program you
belong to and remembers which one you were last in (per person, in
`localStorage`). Role flags, sections and colours all describe that current
program, so a student who directs one program and plays in another gets the right
rights in each.

Rules the code follows, and that changes should keep:

- **No component talks to `supabase` directly.** Reads go through `queries.ts`,
  writes and analytics through `rpc.ts`. A component never passes a band id that
  the server trusts for authorization — the RPCs derive it from the caller.
- **Never invent an RPC or a table column.** If the database doesn't have it,
  add a migration.
- **On failure, show it.** An error is an `Alert` or a toast, never a silent
  `catch` or a zero.
- **Say "program".** The database's word is `ensemble`; it must never reach a
  user. "Band" is right only where the program on screen *is* the band (its own
  name, the "Band Meeting" event type).
- **Confirmations use `ConfirmSheet`**, never `window.confirm`.
- Mobile first: 44px minimum tap targets, `Sheet` instead of a desktop modal.

## 6. Not done yet

- **Before real people sign in: run `scripts/migrate/03b_clerk_import.sh`.** All
  three existing profiles currently have `clerk_id = NULL`, because the Clerk
  import has never run. Nothing resolves them to a Clerk account, so every real
  user would land on the join screen — and joining would create a *second*
  profile for somebody who already has one. Nothing else here matters until this
  is done.
- **Deploy** `clerk_user_created` (`supabase/functions/clerk_user_created/`). The
  code is written — svix signature check, join-code gate, `register_signup`,
  idempotent on redelivery — but until it is deployed *and* Clerk's
  `user.created` webhook points at it, a brand-new account has no profile and
  lands on the "not on the roster" screen:

  ```bash
  supabase secrets set --project-ref <NEW_PROJECT_REF> \
    CLERK_WEBHOOK_SECRET=whsec_… BAND_SLUG=band
  supabase functions deploy clerk_user_created \
    --project-ref <NEW_PROJECT_REF> --no-verify-jwt
  ```

  `--no-verify-jwt` is not optional (Clerk cannot present a Supabase JWT; the
  svix signature is the check).
- The Clerk sign-up form needs the join-code field the webhook reads — a custom
  field stored in `unsafe_metadata` as `join_code` (optional `section` too).
- Banning a person in Clerk when a director removes them from the roster:
  `deactivate_member` only touches `memberships` today, so a removed student can
  still sign in and see the "not on the roster" screen.
- Avatar upload: the `avatars` bucket exists, but nothing uploads to it yet.
- `docs/CUTOVER.md` and `scripts/migrate/run_all.sh` (Phase 4).
- The new Vercel project for this frontend.
