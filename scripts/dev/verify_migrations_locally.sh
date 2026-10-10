#!/usr/bin/env bash
# ============================================================================
# verify_migrations_locally.sh — apply every migration to a throwaway local
# database and run every SQL suite, without touching the live project.
# ----------------------------------------------------------------------------
# READ-ONLY with respect to Supabase: it never reads .env and never connects to
# anything but the local PostgreSQL in .tools/pgsql. Safe to run any time.
#
#   bash scripts/dev/verify_migrations_locally.sh
#
# Why it exists: `06_apply_migrations.sh --dry-run` rehearses against the real
# NEW project, which needs credentials and a network. This proves the same
# thing locally in about a minute — that 007…latest apply to a database shaped
# like the one the restore produces, every migration's own verification block
# passes, and every suite passes afterwards. It is what caught
# `ERROR: cannot change name of input parameter "p_clerk_id"` in 021, which a
# partial schema cannot reproduce because the conflict is with a function the
# *restored* schema already defines.
#
# It rebuilds the database from scratch on every run:
#   1. a stand-in for the hosted-platform objects (roles, `auth`, `storage`,
#      the realtime publication, Supabase's default privileges)
#   2. scripts/migrate/out/schema.sql + data.sql — the dump the pipeline restores
#   3. supabase/migrations/*.sql in filename order
#   4. supabase/tests/*.sql
#
# The stubs in step 1 are the only thing here that is not exactly the hosted
# service. They are deliberately minimal: `auth.users`/`auth.identities` and a
# `storage.objects` with the columns the dump's COPY blocks name, plus the
# default privileges Supabase itself sets (without which the suites' fixtures
# fail on TABLE privilege instead of on the RLS policies they test).
# ============================================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PG_BIN="$REPO_ROOT/.tools/pgsql/bin"
PG_DATA="$REPO_ROOT/.tools/pgcheck/data"
PG_LOG="$REPO_ROOT/.tools/pgcheck/server.log"
PG_PORT="${PG_PORT:-55435}"
DB="${DB:-rhs_local_check}"

if [[ ! -x "$PG_BIN/psql" ]]; then
  echo "No PostgreSQL client at $PG_BIN/psql — see scripts/migrate/README.md." >&2
  exit 1
fi
export PATH="$PG_BIN:$PATH"
export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres

if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
  echo "Initialising a throwaway cluster at .tools/pgcheck/data …"
  mkdir -p "$REPO_ROOT/.tools/pgcheck"
  initdb -D "$PG_DATA" -U postgres -A trust >/dev/null || exit 1
fi
if ! pg_isready -q 2>/dev/null; then
  pg_ctl -D "$PG_DATA" -l "$PG_LOG" -o "-p $PG_PORT -c listen_addresses=127.0.0.1" -w start >/dev/null 2>&1 \
    || { echo "Could not start PostgreSQL — see $PG_LOG" >&2; exit 1; }
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/00_platform_stubs.sql" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto;

create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255),
  email varchar(255), encrypted_password varchar(255),
  email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz,
  recovery_token varchar(255), recovery_sent_at timestamptz,
  email_change_token_new varchar(255), email_change varchar(255), email_change_sent_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  is_super_admin boolean, created_at timestamptz default now(), updated_at timestamptz default now(),
  phone text unique, phone_confirmed_at timestamptz, phone_change text default '',
  phone_change_token varchar(255) default '', phone_change_sent_at timestamptz,
  email_change_token_current varchar(255) default '', email_change_confirm_status smallint default 0,
  banned_until timestamptz, reauthentication_token varchar(255), reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false, deleted_at timestamptz, is_anonymous boolean not null default false
);
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null, identity_data jsonb not null,
  provider text not null, last_sign_in_at timestamptz, created_at timestamptz,
  updated_at timestamptz, id uuid primary key,
  constraint identities_provider_id_provider_key unique (provider_id, provider));

-- auth.uid(): the JWT `sub` as a uuid, NULL when there is no usable claim.
create or replace function auth.uid() returns uuid language plpgsql stable as $$
declare v text;
begin
  v := nullif(current_setting('request.jwt.claims', true), '');
  if v is null then return null; end if;
  begin return (v::jsonb ->> 'sub')::uuid; exception when others then return null; end;
end $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create schema if not exists storage;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select case when array_length(string_to_array(name, '/'), 1) > 1
    then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    else array[]::text[] end $$;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text,
  type text default 'STANDARD', versioning_status text default 'DISABLED',
  lifecycle_configuration jsonb, lifecycle_configuration_generation int);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, created_at timestamptz default now(),
  updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, version text, user_metadata jsonb, level int,
  archived_at timestamptz, is_delete_marker boolean, is_versioned boolean);

-- Supabase ships this publication and the dump adds its tables to it.
create publication supabase_realtime;

-- Supabase's default privileges. Without them, tables the migrations create have
-- no grants for anon/authenticated/service_role and the suites fail on TABLE
-- privilege rather than on the RLS policies they are actually testing.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL

step() {
  local label="$1"; shift
  local out; out="$("$@" 2>&1 >/dev/null)"; local rc=$?
  if [[ $rc -ne 0 ]]; then
    printf 'FAIL %s\n' "$label"
    printf '%s\n' "$out" | grep -m3 -E 'ERROR|FATAL' || printf '%s\n' "$out" | tail -3
    return 1
  fi
  printf 'ok   %s\n' "$label"
}

echo "=== rebuilding $DB from the dump + migrations ==="
dropdb --if-exists "$DB" 2>/dev/null
createdb "$DB" || exit 1
step "platform stubs (roles, auth, storage, publication, grants)" \
  psql -q -v ON_ERROR_STOP=1 -f "$WORK/00_platform_stubs.sql" -d "$DB" || exit 1

# supabase_vault and uuid-ossp are not in the portable build and nothing uses them.
sed -E 's/^CREATE EXTENSION IF NOT EXISTS (supabase_vault|"uuid-ossp").*/-- & (unavailable locally)/; s/^COMMENT ON EXTENSION (supabase_vault|"uuid-ossp").*/-- &/' \
  scripts/migrate/out/schema.sql > "$WORK/base.sql"
step "base schema (scripts/migrate/out/schema.sql)" \
  psql -q -v ON_ERROR_STOP=1 -f "$WORK/base.sql" -d "$DB" || exit 1

# The data dump covers public only, so the FK to auth.users is satisfied the way
# 02_restore.sh does it: as the replication role, with triggers off.
{ echo "set session_replication_role = replica;"; cat scripts/migrate/out/data.sql; } > "$WORK/data.sql"
step "base data (scripts/migrate/out/data.sql)" \
  psql -q -v ON_ERROR_STOP=1 -f "$WORK/data.sql" -d "$DB" || exit 1

MIGRATIONS=0
for f in supabase/migrations/*.sql; do
  step "$(basename "$f")" psql -q -v ON_ERROR_STOP=1 -f "$f" -d "$DB" || exit 1
  MIGRATIONS=$((MIGRATIONS + 1))
done

echo
echo "=== suites ==="
FAILED=0
PASSED=0
SKIPPED=0
for f in supabase/tests/*.sql; do
  name="$(basename "$f")"
  # Same rule as 06_apply_migrations.sh: a suite that declares a legacy-schema
  # precondition targets the pre-migration clone, which 05_verify.sh runs it
  # against at the Phase 1 gate.
  if sed -n '1,25p' "$f" | tr -d '\r' | grep -q '^-- requires-nullable-column:'; then
    printf 'SKIP %-32s legacy-schema precondition (run by 05_verify.sh on the clone)\n' "$name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  out="$(psql -q -v ON_ERROR_STOP=1 -f "$f" -d "$DB" 2>&1)"; rc=$?
  if [[ $rc -eq 0 ]]; then
    printf 'PASS %-32s %s\n' "$name" "$(printf '%s\n' "$out" | grep -iE 'PASSED' | tail -1)"
    PASSED=$((PASSED + 1))
  else
    printf 'FAIL %-32s\n' "$name"
    printf '%s\n' "$out" | grep -m3 -E 'ERROR|FAIL:' | sed 's/^/       /'
    FAILED=$((FAILED + 1))
  fi
done

echo
printf '%d migrations applied, %d suites passed, %d failed, %d skipped\n' \
  "$MIGRATIONS" "$PASSED" "$FAILED" "$SKIPPED"
[[ $FAILED -eq 0 ]] || exit 1
