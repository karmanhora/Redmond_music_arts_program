#!/usr/bin/env bash
# ============================================================================
# lib.sh — shared helpers for the RHS-Music migration pipeline.
# Source this file; don't execute it.
#
# Safety model (see docs/PLATFORM_PLAN.md):
#   * Credentials come from environment variables only (repo-root .env is
#     gitignored). Values are NEVER printed, logged or echoed by any script.
#   * Anything that READS the OLD (live) project says so in its banner.
#   * Anything that WRITES to a database must pass confirm_target_new(), which
#     prints the target + action and requires an explicit confirmation
#     (CONFIRM_TARGET=NEW env var, or typing NEW interactively). OLD can never
#     be confirmed — a write to OLD is always refused.
# ============================================================================
set -euo pipefail

MIGRATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$MIGRATE_DIR/../.." && pwd)"
OUT_DIR="$MIGRATE_DIR/out"

# Portable Postgres client tools (psql/pg_dump) may live in .tools/pgsql/bin
# (machine-local, gitignored — see scripts/migrate/README.md). Prefer them when
# present so the pipeline runs without a system-wide Postgres install.
if [[ -d "$REPO_ROOT/.tools/pgsql/bin" ]]; then
  PATH="$REPO_ROOT/.tools/pgsql/bin:$PATH"
  export PATH
fi

_ts() { date +%H:%M:%S; }
log()  { printf '[%s]  %s\n' "$(_ts)" "$*"; }
warn() { printf '[%s]  WARNING: %s\n' "$(_ts)" "$*" >&2; }
die()  { printf '[%s]  ERROR: %s\n' "$(_ts)" "$*" >&2; exit 1; }

banner() { # banner "TARGET …" "what this run does"
  printf '\n============================================================================\n'
  printf '%s\n' "$1"
  printf '%s\n' "$2"
  printf '============================================================================\n\n'
}

# Load repo-root .env (gitignored) into the environment without printing it.
load_env() {
  local f="$REPO_ROOT/.env"
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$f"
    set +a
    log "Loaded .env (values are never printed)."
  else
    warn "No .env at repo root — relying on process environment only."
  fi
}

# require_vars VAR [VAR …] — fail fast naming any missing variable (never its value).
require_vars() {
  local v missing=0
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      warn "Missing required env var: $v"
      missing=1
    fi
  done
  [[ "$missing" -eq 0 ]] || die "Set the missing variable(s) in .env at the repo root (gitignored; values never printed)."
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1 ($2)"
}

# confirm_target_new "what this run does" — gate for anything that MODIFIES the
# NEW database (or another external system of record). Refuses to run when
# NEW_DB_URL looks like the live OLD project, and requires an explicit NEW.
confirm_target_new() {
  local action="$1"
  banner "TARGET: NEW project — THIS MODIFIES DATA" "$action"
  if [[ -n "${NEW_DB_URL:-}" && "${NEW_DB_URL}" == "${OLD_DB_URL:-}" ]]; then
    die "OLD_DB_URL and NEW_DB_URL are identical — refusing to write. Check .env."
  fi
  local answer="${CONFIRM_TARGET:-}"
  if [[ -z "$answer" ]]; then
    if [[ -t 0 ]]; then
      read -r -p 'Type NEW to proceed (anything else aborts): ' answer
    else
      die "Non-interactive run: set CONFIRM_TARGET=NEW to confirm this write to NEW."
    fi
  fi
  [[ "$answer" == "NEW" ]] || die "Aborted (confirmation was not NEW)."
}

# --- reusable read-only measurements (used by 01_dump.sh and 05_verify.sh) ---

table_list() { # table_list <db_url> — every counted table, fully qualified
  local db="$1"
  {
    psql "$db" -X -At -v ON_ERROR_STOP=1 \
      -c "select table_schema || '.' || table_name
            from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE'
           order by 1"
    # Auth + storage live outside `public`; they are part of the clone too.
    printf 'auth.users\nauth.identities\nstorage.objects\n'
  } | tr -d '\r' | sort -u   # strip CRLF (psql on Windows) so names/diffs stay clean
}

collect_row_counts() { # collect_row_counts <db_url> <outfile>
  local db="$1" out="$2" t n
  : > "$out"
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    n="$(psql "$db" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from $t")"
    printf '%s|%s\n' "$t" "$n" >> "$out"
  done < <(table_list "$db")
  log "Row counts written to ${out#"$REPO_ROOT"/}"
}

attendance_checksum() { # attendance_checksum <db_url> — deterministic fingerprint
  local db="$1"
  psql "$db" -X -At -v ON_ERROR_STOP=1 <<'SQL'
select count(*) || '|' ||
       coalesce(md5(string_agg(
         id::text || '|' || event_id::text || '|' || student_id::text || '|' ||
         status || '|' || attended::text || '|' || coalesce(checked_in_at::text, ''),
         ',' order by id)), 'EMPTY')
  from public.attendance_records;
SQL
}
