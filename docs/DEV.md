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
| `supabase/migrations/007`–`022` | The multi-program schema, policies, RPCs, calendar sync, join flow, Supabase Auth identity, `create_program` |
| `supabase/tests/` | SQL suites (backfill, isolation, security, join, create program) run inside transactions |
| `supabase/templates/` | The six branded auth emails Supabase sends — see [`EMAIL_SETUP.md`](EMAIL_SETUP.md) |
| `public/` | The app's brand assets: one `logo.svg` and the icons rendered from it — see [`BRAND_ASSETS.md`](BRAND_ASSETS.md) |
| `scripts/migrate/` | The clone pipeline: dump OLD → restore → migrate → verify |
| `scripts/brand/` | Renders the PNG icons from `public/logo.svg` with a headless browser |
| `scripts/dev/` | `verify_migrations_locally.sh` — applies every migration and runs every suite against a throwaway local database |
| `docs/` | This file, the platform plan, [`AUTH_MIGRATION.md`](AUTH_MIGRATION.md), [`EMAIL_SETUP.md`](EMAIL_SETUP.md), [`BRAND_ASSETS.md`](BRAND_ASSETS.md) |
| `reference/RHS-BAND/` | Read-only clone of the old app, for conventions only |
| `.tools/pgsql/bin` | Portable PostgreSQL 18 client used by the migration scripts (gitignored) |

## 2. Run the app

Requires Node 22+ (built on v22.23.2, npm 12).

```bash
npm install
cp .env.example .env.local     # then fill in the two values below
npm run dev                    # http://localhost:5173
```

`.env.local` is gitignored and is the only file the web app reads. Two variables,
because Supabase is both the database and the sign-in system:

| Variable | Where to get it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API (the **NEW** project) |
| `VITE_SUPABASE_ANON_KEY` | Same page, the `anon` / publishable key |

Both are public by design: the anon key grants nothing on its own, because every
table is behind RLS. The service-role key must never get a `VITE_` prefix.

Vite reads env files **once at startup** — restart `npm run dev` after editing.
If a variable is missing the app renders a screen naming exactly what is absent
instead of a blank page (`src/screens/ConfigMissingScreen.tsx`).

Checks:

```bash
npm run typecheck      # tsc -b --noEmit
npm run build          # typecheck + production bundle
npm run preview        # serve the built bundle
```

## 3. Authentication (Supabase Auth is the only auth system)

Sign-in is Supabase Auth. The database and the identity provider are the same
service, so there is no third-party script, no token bridge and no proxy — which
is also why the landing page no longer waits on a network round-trip before it
can render. The flow:

1. `src/screens/AuthScreen.tsx` collects an email and password and calls
   `supabase.auth.signInWithPassword(...)`. Sign-up, "email me a reset link" and
   "set a new password" (from that link) are the same screen in other modes.
2. `src/hooks/useAuth.tsx` is the app's whole idea of a session: it restores the
   stored one on the first tick, subscribes to `onAuthStateChange`, and keeps the
   app signed in across a refresh. `src/App.tsx` routes on its status — including
   a recovery link, which takes the screen over until the new password is set.
3. The Supabase client in `src/lib/supabase.ts` attaches the session to every
   request by itself. PostgREST runs the request as the `authenticated` role with
   `sub` = the auth user id.
4. `profiles.auth_user_id` (migration 021) is how an account maps to a person.
   Everything else (roles, section) lives on `memberships`, per program.

Supabase also sends the account emails — confirmation, password reset, magic
link, email change, reauthentication — from the templates in
`supabase/templates/`. Nothing in the app code depends on them, so they are
applied through the dashboard or `supabase config push`; the operator guide
(which email fires when, the SMTP ceiling, redirect URLs, how to test) is
[`EMAIL_SETUP.md`](EMAIL_SETUP.md).

Starting a program does not need anybody's approval: a signed-in teacher names one
and `create_program()` (migration 022) makes them its director. Directors are the
only ones who can then add anybody else, through their program's join code.

Migration 021 replaced `profiles.clerk_id` with `profiles.auth_user_id` and
repointed `public.current_profile_id()` at it. That one helper is what every RLS
policy, guard trigger and RPC composes on, which is why moving the identity
provider did not require rewriting any of them. The whole story — including the
one manual step for people who already have attendance history — is in
[`docs/AUTH_MIGRATION.md`](AUTH_MIGRATION.md).

No identity helper is executable by `anon`, and an unknown `sub` resolves to NULL,
so every policy denies rather than guessing.

**Roster gate.** A signed-in account with no `profiles` row lands on the join
screen (`src/screens/JoinProgramScreen.tsx`, rendered standalone) and picks which
program to join. The **join code** is the only door, and it is validated
server-side — never in the browser:

```
/join  ──►  RPC  join_program(slug, code)      ◄── the path people actually use
                   │  validate_join_code()   (rate-limited: 5 failures / 2 min per IP)
                   ├─ profiles       : created on somebody's first program
                   └─ memberships    : one row per program they join

service role  register_signup()  ◄── pre-provisioning; nothing calls it in v1
```

There is deliberately **no `auth.users` signup trigger**: the join code is
collected on the join screen *after* the account exists, which is also the only
flow that can add somebody's **second** program (reached from the program
switcher or Profile). Migration 018 removed the old trigger and 021 does not
bring it back — re-adding it would create a second profile for every new account.

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
(`join_program()` and `list_active_programs()`); **021 must be applied before
anyone signs in**, because it is what resolves a Supabase Auth account to a
`profiles` row — without it every request is `anon` and the app looks empty;
022 is what lets a teacher start a program (`create_program()`).

### Proving the migrations without credentials

```bash
bash scripts/dev/verify_migrations_locally.sh
```

[`scripts/dev/verify_migrations_locally.sh`](../scripts/dev/verify_migrations_locally.sh)
rebuilds a throwaway local database — the fleet of platform objects a hosted
project provides, then `scripts/migrate/out/{schema,data}.sql` (the dump the
pipeline restores), then `supabase/migrations/*.sql`, then every suite — and
exits non-zero on the first failure. It reads no `.env` and touches nothing but
the local PostgreSQL in `.tools/pgsql`, so it is safe to run freely. It skips
`supabase/tests/security_verification.sql` for the same reason the pipeline does:
that suite declares a legacy-schema precondition and belongs to the pre-migration
clone, which is what `05_verify.sh` runs it against.

This is the cheap check, and it is worth running before any live apply: it caught
a migration that could not be applied at all (`021` renamed an input parameter of
`register_signup`, which `create or replace` refuses to do — see
[`AUTH_MIGRATION.md`](AUTH_MIGRATION.md) §9). A stub schema that lacks the function
being replaced cannot reproduce that class of failure.

## 5. How the frontend is put together

```
src/lib/queries.ts   the few table reads (RLS-scoped: profiles, events, attendance…)
src/lib/rpc.ts       every write, plus analytics — all SECURITY DEFINER RPCs
src/lib/types.ts     row + RPC shapes; roles live on memberships, never on profiles
src/hooks/useAuth.tsx      the Supabase Auth session (status, user, sign in/out, password)
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

- **Apply migration 021 to the live project before anyone signs in**, then set
  the dashboard's Site URL / Redirect URLs. The exact SQL, the settings and the
  one manual step for people who already have attendance history are in
  [`docs/AUTH_MIGRATION.md`](AUTH_MIGRATION.md).
- **Existing people are not linked to an account yet.** `profiles.auth_user_id`
  is NULL for anybody who has never signed in through Supabase Auth. Migration
  021 backfills the exact matches it can prove (a surviving `auth.users` row with
  the same uuid as the profile); every other person links the first time they join
  a program with their code. If somebody already has a `profiles` row and an
  attendance history *and* no matching `auth.users` row, they must be linked by
  hand **before** they sign up — otherwise joining creates a second profile.
  §4 of [`docs/AUTH_MIGRATION.md`](AUTH_MIGRATION.md) has the reviewed SQL.
- **Removing somebody does not lock their login.** `deactivate_member` sets
  `memberships.active = false` and, when they are on no other roster,
  `profiles.deactivated = true` — which makes `join_program` refuse them. They
  can still authenticate; they cannot get back into the program. The Clerk-era
  ban (`BanUser`) went with Clerk.
- Avatar upload: the `avatars` bucket exists, but nothing uploads to it yet.
- `docs/CUTOVER.md` and `scripts/migrate/run_all.sh` (Phase 4).
- The new Vercel project for this frontend.
