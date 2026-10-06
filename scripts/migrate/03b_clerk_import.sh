#!/usr/bin/env bash
# ============================================================================
# 03b_clerk_import.sh — hash-preserving user migration into Clerk.
# ----------------------------------------------------------------------------
# TARGET: OLD is READ-ONLY (SELECTs from auth.users). Writes go to Clerk only
# in --apply mode (external system of record — same confirmation rule).
#
# Steps:
#   1. Build out/clerk_import.jsonl from OLD auth.users: one Clerk CreateUser
#      payload per line (email, external_id = our user uuid, password_digest =
#      Supabase bcrypt hash, name from raw_user_meta_data). The file contains
#      password hashes: created with umask 077 in the gitignored out/ dir and
#      never printed.
#   2. Run clerk_import.mjs (dry run by default; --apply to create).
#
# The Phase 1 hash-acceptance spike (docs/PLATFORM_PLAN.md §13.3):
#   03b_clerk_import.sh --apply --limit 2
#   with CLERK_SECRET_KEY of a throwaway Clerk DEVELOPMENT instance and a known
#   account, then sign in there with the real password before any bulk run.
#
# Env: OLD_DB_URL (required), CLERK_SECRET_KEY (required for --apply).
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_vars OLD_DB_URL
need_cmd psql "PostgreSQL client"
need_cmd node "Node 18+ (built-in fetch) for clerk_import.mjs"

APPLY_ARGS=()
if [[ "${1:-}" == "--apply" ]]; then
  APPLY_ARGS+=(--apply)
  shift
fi
# pass through --limit N / --file path
[[ $# -gt 0 ]] && APPLY_ARGS+=("$@")

if [[ " ${APPLY_ARGS[*]:-} " == *" --apply "* ]]; then
  require_vars CLERK_SECRET_KEY
  confirm_target_new "Create users in Clerk from out/clerk_import.jsonl (passwords preserved via bcrypt hash import)."
else
  banner "TARGET: OLD (read-only) + Clerk (dry run) — NO WRITES" \
    "Building out/clerk_import.jsonl and previewing the import. Use --apply to create users."
fi

mkdir -p "$OUT_DIR"
umask 077

log "Building out/clerk_import.jsonl from OLD auth.users (contains password hashes — never printed) …"
psql "$OLD_DB_URL" -X -At -v ON_ERROR_STOP=1 > "$OUT_DIR/clerk_import.jsonl" <<'SQL'
select json_build_object(
         'external_id', u.id::text,
         'email_address', array[lower(u.email)],
         'first_name', nullif(split_part(coalesce(u.raw_user_meta_data ->> 'full_name', ''), ' ', 1), ''),
         'last_name', nullif(trim(substring(coalesce(u.raw_user_meta_data ->> 'full_name', '') from position(' ' in coalesce(u.raw_user_meta_data ->> 'full_name', '')) + 1)), ''),
         'password_digest', u.encrypted_password,
         'password_hasher', 'bcrypt'
       )::text
  from auth.users u
 where coalesce(u.email, '') <> ''
 order by u.created_at;
SQL

ROWS=$(grep -c . "$OUT_DIR/clerk_import.jsonl" || true)
log "Built $ROWS row(s). Preview shows external_ids only."

log "Running clerk_import.mjs ${APPLY_ARGS[*]:-} (dry run unless --apply) …"
node "$MIGRATE_DIR/clerk_import.mjs" --file "$OUT_DIR/clerk_import.jsonl" ${APPLY_ARGS[@]+"${APPLY_ARGS[@]}"}

log "03b_clerk_import complete. After a successful bulk import: verify sign-in with 2-3 real accounts before cutover (04_functions_config.md)."
