# scripts/migrate — RHS Band → RHS Music migration pipeline

Idempotent, re-runnable clone of the live RHS Band Supabase project into a new
project. Documented plan: `docs/PLATFORM_PLAN.md` (Phase 1 = §9). Scripts never
print, log, or commit credentials — everything comes from environment variables
in the **gitignored** repo-root `.env`.

There is no third-party user import any more. Accounts are **Supabase Auth**
accounts, so `auth.users` (which this pipeline already copies) is the identity
store; `profiles.auth_user_id` is how the app links an account to a person
(`supabase/migrations/021_supabase_auth.sql`). The former
`03b_clerk_import.sh` / `clerk_import.mjs` pair was deleted with Clerk itself.

## Run order

| Script | Target | Writes? | Purpose |
|---|---|---|---|
| `01_dump.sh` | OLD (live) | no — dumps only | roles (idempotent SQL guards), schema, data (COPY), migration history, baseline counts + attendance fingerprint → `out/` |
| `02_restore.sh` | NEW | **yes** | restore roles → schema → data (`session_replication_role = replica` so triggers don't fire) |
| `03_auth_storage.sh` | OLD + NEW | only with `--apply` | verify/reapply `handle_new_user` + avatar bucket/policies; verify `auth.users`/`identities`; copy avatar objects via Storage API |
| `04_functions_config.md` | NEW | manual | edge functions, secrets, cron, Supabase Auth URLs/templates + Vercel checklist |
| `05_verify.sh` | OLD + NEW | no (suite rolls back) | row counts, auth sanity, attendance fingerprint + spot checks, RLS everywhere, `tests/security_verification.sql` |

`out/` is gitignored and created with `umask 077` — it contains password hashes
(`data.sql`, `auth_data.sql`). Never commit or share it.

**Tooling note:** the Supabase CLI's `db dump` requires Docker on machines
without the local stack (CLI 2.119 on Windows), so `01_dump.sh` calls
`pg_dump` 18 directly — the same engine the CLI wraps. Portable Postgres
client tools live in gitignored `.tools/pgsql/bin` and are added to `PATH`
automatically by `lib.sh`. The Supabase CLI is still used where it talks to
the Management API (edge functions in `04_functions_config.md`).

## Safety model

- Scripts that read OLD print a **READ-ONLY** banner and only run SELECTs/dumps.
- Scripts that modify a database call `confirm_target_new`, which
  prints the exact target and action and requires `CONFIRM_TARGET=NEW` (or
  typing `NEW` interactively). `02_restore.sh` additionally refuses to run when
  `NEW_DB_URL == OLD_DB_URL`. There is no path in this pipeline that writes to
  the OLD project.
- Workflow rule (human side): before each modifying run, the run log must state
  **target (OLD vs NEW), what it does**, and receive an explicit "go".

## Environment variables (repo-root `.env`, gitignored — values never printed)

| Var | Used by | Notes |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | optional tooling | Supabase Management API token (`sbp_…`) — rotate after the migration |
| `OLD_DB_URL` | 01, 03, 05 | Postgres connection string of the **live** project (read-only use) |
| `NEW_DB_URL` | 02, 03, 05 | Postgres connection string of the **new** project — prefer the direct `:5432` session connection (the pooler can restrict `session_replication_role`) |
| `OLD_SUPABASE_URL`, `OLD_SERVICE_ROLE_KEY` | 03 (`--apply`) | Storage API source (avatar copy) |
| `NEW_SUPABASE_URL`, `NEW_SUPABASE_ANON_KEY`, `NEW_SERVICE_ROLE_KEY` | 03, tooling | Storage API destination + app keys |
| `CONFIRM_TARGET` | 02, 03 `--apply` | set to `NEW` to confirm a write in non-interactive runs |

## First dry run (what to paste back)

1. `OLD_DB_URL` — Supabase Dashboard → Project Settings → Database →
   Connection string → **URI** (Session pooler is fine for read-only dumps).
2. `NEW_DB_URL` — same for the new project; use the **Direct connection**
   (`db.<ref>.supabase.co:5432`) so `session_replication_role` is allowed.
3. Confirm you want to run: `01_dump.sh` first (read-only), then review
   `out/`, then give the explicit "go" for `02_restore.sh` (**TARGET: NEW —
   writes roles + schema + data**).

Never paste passwords into chat if you can avoid it — prefer setting `.env`
yourself and telling me it's ready. (If a secret does land in chat, rotate it
afterwards.)
