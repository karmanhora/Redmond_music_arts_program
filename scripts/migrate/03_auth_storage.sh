#!/usr/bin/env bash
# ============================================================================
# 03_auth_storage.sh — auth & storage schema verification / repair + avatar copy
# ----------------------------------------------------------------------------
# Mixed script; default mode is VERIFY-ONLY (read-only on both sides):
#   03_auth_storage.sh            verify + write a diff report to out/
#   03_auth_storage.sh --apply    additionally: reapply missing custom objects
#                                 (sql/reapply_auth_storage.sql) and copy the
#                                 avatars bucket OLD → NEW. MODIFIES NEW —
#                                 requires CONFIRM_TARGET=NEW (see lib.sh).
#
# Parts (per docs/PLATFORM_PLAN.md §9):
#   (a) custom triggers/policies on the auth and storage schemas.
#       Note: `supabase db diff` only diffs linked-vs-local, not OLD-vs-NEW, so
#       we diff schema-only dumps of the auth+storage schemas instead and back
#       them with targeted object assertions. (Equivalent coverage; the CLI
#       command remains useful interactively: supabase db diff --schema auth,storage.)
#   (b) auth.users / auth.identities were copied (counts + password-hash
#       sanity). If not, --apply dumps and loads them explicitly (triggers off).
#   (c) avatars bucket objects copied OLD → NEW via the Storage API (SQL dumps
#       do not include object-store bytes). Skips objects that already exist.
#
# Env: OLD_DB_URL, NEW_DB_URL, OLD_SERVICE_ROLE_KEY, NEW_SERVICE_ROLE_KEY,
#      OLD_SUPABASE_URL, NEW_SUPABASE_URL (keys for the Storage API only;
#      values never printed).
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_vars OLD_DB_URL NEW_DB_URL

need_cmd psql    "PostgreSQL client"
need_cmd pg_dump "ships with PostgreSQL client tools"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

if [[ "$APPLY" == "1" ]]; then
  confirm_target_new "Reapply custom auth/storage objects, (re)load auth.users/identities if counts differ, and copy avatars OLD → NEW."
  require_vars OLD_SERVICE_ROLE_KEY NEW_SERVICE_ROLE_KEY OLD_SUPABASE_URL NEW_SUPABASE_URL
  need_cmd curl "Storage API calls"
  need_cmd jq   "jq (https://jqlang.github.io/jq/)"
else
  banner "TARGET: OLD + NEW — READ-ONLY (verification + diff report only)" \
    "Run with --apply (and CONFIRM_TARGET=NEW) to repair objects or copy avatars."
fi

log "(a) Diffing auth + storage schemas OLD vs NEW …"
pg_dump "$OLD_DB_URL" --schema-only --schema=auth --schema=storage > "$OUT_DIR/auth_storage_old.sql"
pg_dump "$NEW_DB_URL" --schema-only --schema=auth --schema=storage > "$OUT_DIR/auth_storage_new.sql"
diff -u "$OUT_DIR/auth_storage_old.sql" "$OUT_DIR/auth_storage_new.sql" > "$OUT_DIR/auth_storage.diff" \
  || warn "auth/storage schema diff is non-empty — review out/auth_storage.diff (baseline Supabase version differences are expected; custom objects are asserted below)."
log "Diff written to out/auth_storage.diff"

# Targeted object assertions: the custom bits we actually depend on.
check_object() { # check_object <label> <db_url> <sql-returning-count>
  local label="$1" db="$2" sql="$3" n
  n="$(psql "$db" -X -At -v ON_ERROR_STOP=1 -c "$sql")"
  if [[ "$n" == "0" ]]; then
    printf 'MISSING|%s\n' "$label"
  else
    printf 'OK|%s|%s\n' "$label" "$n"
  fi
}

# A word on the `handle_new_user trigger on auth.users` assertion below: 018
# drops that trigger and 021 does NOT re-create it, on purpose. Supabase Auth
# owns the account, and the join code is validated in the app by
# `join_program()` (020) after that account exists — the only flow that can also
# add somebody's second program. OLD still has the trigger, so it stays in the
# list; a NEW project that has run 018 reports it MISSING by design, and
# `--apply` (which restores it from sql/reapply_auth_storage.sql) is only useful
# while deliberately rebuilding a faithful clone.
ASSERTS="
handle_new_user trigger on auth.users|select count(*) from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass|
avatars bucket row|select count(*) from storage.buckets where id = 'avatars'|
avatars_public_read policy|select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_public_read'|
avatars_write_own policy|select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_write_own'|
avatars_update_own policy|select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_update_own'|
avatars_delete_own policy|select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_delete_own'|
"

log "Object assertions (OLD expected OK; NEW must match):"
MISSING=0
while IFS='|' read -r label sql _; do
  [[ -n "$label" ]] || continue
  old_res="$(check_object "$label" "$OLD_DB_URL" "$sql")"
  new_res="$(check_object "$label" "$NEW_DB_URL" "$sql")"
  printf '    OLD: %s\n    NEW: %s\n' "$old_res" "$new_res"
  [[ "$new_res" == MISSING\|* ]] && MISSING=1
done <<< "$ASSERTS"

if [[ "$MISSING" == "1" && "$APPLY" == "1" ]]; then
  log "Reapplying custom objects (idempotent) …"
  psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATE_DIR/sql/reapply_auth_storage.sql"
  log "Reapplied — re-run this script without --apply to re-verify."
elif [[ "$MISSING" == "1" ]]; then
  warn "Objects missing on NEW (verify-only run) — re-run with --apply to repair."
fi

# (b) auth.users / auth.identities presence + password-hash sanity.
log "(b) auth.users / auth.identities counts and hash sanity:"
old_users="$(psql "$OLD_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users")"
new_users="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users")"
old_ids="$(psql "$OLD_DB_URL"   -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.identities")"
new_ids="$(psql "$NEW_DB_URL"   -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.identities")"
bad_hash_old="$(psql "$OLD_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users where encrypted_password is null or encrypted_password = ''")"
bad_hash_new="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users where encrypted_password is null or encrypted_password = ''")"
log "    auth.users      OLD=$old_users NEW=$new_users  (empty hashes: OLD=$bad_hash_old NEW=$bad_hash_new)"
log "    auth.identities OLD=$old_ids   NEW=$new_ids"

if [[ "$old_users" != "$new_users" || "$old_ids" != "$new_ids" ]]; then
  if [[ "$APPLY" == "1" ]]; then
    log "Counts differ — explicit auth.users/identities dump+load (triggers off) …"
    pg_dump "$OLD_DB_URL" --data-only --table=auth.users --table=auth.identities \
      > "$OUT_DIR/auth_data.sql"
    umask 077
    psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
      -c "set session_replication_role = replica" \
      -f "$OUT_DIR/auth_data.sql"
    log "Loaded. Re-run without --apply to verify counts."
  else
    warn "auth counts differ (verify-only run) — re-run with --apply to dump/load explicitly."
  fi
fi

# (c) Avatar objects OLD → NEW via the Storage API.
if [[ "$APPLY" == "1" ]]; then
  log "(c) Copying avatars bucket objects OLD → NEW (existing objects skipped) …"
  umask 077
  list_page() { # list_page <offset> — JSON array of {name, updated_at, metadata}
    curl -sfS -H "Authorization: Bearer $OLD_SERVICE_ROLE_KEY" -H "apikey: $OLD_SERVICE_ROLE_KEY" \
      "$OLD_SUPABASE_URL/storage/v1/object/list/avatars" \
      -H 'Content-Type: application/json' \
      -d "{\"prefix\":\"\",\"limit\":100,\"offset\":$1,\"sortBy\":{\"column\":\"name\",\"order\":\"asc\"}}"
  }
  offset=0
  COPIED=0
  SKIPPED=0
  FAILED=0
  while :; do
    page="$(list_page "$offset")" || die "Storage list failed on OLD (check OLD_SUPABASE_URL / OLD_SERVICE_ROLE_KEY — values never printed)."
    count="$(jq 'length' <<< "$page")"
    [[ "$count" == "0" ]] && break
    while IFS= read -r obj; do
      name="$(jq -r '.name' <<< "$obj")"
      [[ "$name" == "null" || -z "$name" ]] && continue
      # Objects live one level deep: <user-id>/<file>. The list endpoint
      # returns paths relative to the bucket when a prefix is used; with an
      # empty prefix Supabase returns folders as entries without metadata.
      if [[ "$(jq -r '.metadata // empty' <<< "$obj")" == "empty" ]]; then
        # folder entry — list inside it
        sub="$(curl -sfS -H "Authorization: Bearer $OLD_SERVICE_ROLE_KEY" -H "apikey: $OLD_SERVICE_ROLE_KEY" \
          "$OLD_SUPABASE_URL/storage/v1/object/list/avatars" \
          -H 'Content-Type: application/json' \
          -d "{\"prefix\":\"$name\",\"limit\":100,\"offset\":0}")" \
          || { FAILED=$((FAILED+1)); continue; }
        while IFS= read -r subobj; do
          sname="$(jq -r '.name' <<< "$subobj")"
          [[ "$sname" == "null" || -z "$sname" ]] && continue
          path="$name/$sname"
          if curl -sfS -o /dev/null -I -H "Authorization: Bearer $NEW_SERVICE_ROLE_KEY" -H "apikey: $NEW_SERVICE_ROLE_KEY" \
               "$NEW_SUPABASE_URL/storage/v1/object/info/avatars/$path"; then
            SKIPPED=$((SKIPPED+1))
            continue
          fi
          tmp="$(mktemp)"
          if curl -sfS -o "$tmp" -H "Authorization: Bearer $OLD_SERVICE_ROLE_KEY" -H "apikey: $OLD_SERVICE_ROLE_KEY" \
               "$OLD_SUPABASE_URL/storage/v1/object/avatars/$path" \
            && curl -sfS -o /dev/null -X POST \
               -H "Authorization: Bearer $NEW_SERVICE_ROLE_KEY" -H "apikey: $NEW_SERVICE_ROLE_KEY" \
               -H 'Content-Type: application/octet-stream' \
               --data-binary @"$tmp" \
               "$NEW_SUPABASE_URL/storage/v1/object/avatars/$path"; then
            COPIED=$((COPIED+1))
          else
            warn "Failed to copy $path"
            FAILED=$((FAILED+1))
          fi
          rm -f "$tmp"
        done <<< "$(jq -c '.[]' <<< "$sub")"
      fi
    done <<< "$(jq -c '.[]' <<< "$page")"
    offset=$((offset + count))
  done
  log "Avatars: copied=$COPIED skipped(existing)=$SKIPPED failed=$FAILED"
  [[ "$FAILED" == "0" ]] || die "Some avatar objects failed to copy — re-run 03_auth_storage.sh --apply (idempotent)."
fi

log "03_auth_storage complete."
