#!/usr/bin/env bash
# ============================================================================
# 05_verify.sh — verify the clone: OLD vs NEW.
# ----------------------------------------------------------------------------
# TARGET: OLD + NEW — READ-ONLY (SELECTs only). The security suite runs inside
# one transaction and ROLLS BACK, so it leaves NEW unchanged.
#
# Checks (any failure → exit 1):
#   1. Per-table row counts: every table that exists on OLD must match on NEW
#      exactly (NEW-only tables — the Phase-2 schema — are reported, not failed).
#   2. auth.users count + password-hash sanity (no empty hashes).
#   3. Attendance history fingerprint + 5-row spot checks (head and tail).
#   4. RLS enabled on EVERY public table (plus auth/storage custom checks).
#   5. Every suite in supabase/tests/ against NEW; each must exit 0 and print a
#      line containing PASSED. Suites roll themselves back.
#
# Env: OLD_DB_URL, NEW_DB_URL. Values never printed.
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_vars OLD_DB_URL NEW_DB_URL
need_cmd psql "PostgreSQL client"

banner "TARGET: OLD + NEW — READ-ONLY (verification only; security suite rolls back)" \
  "Comparing the clone against the live project."

FAILURES=0
fail_check() { warn "CHECK FAILED: $1"; FAILURES=$((FAILURES+1)); }

mkdir -p "$OUT_DIR"

# --- 1. Row counts ----------------------------------------------------------
log "1. Row counts per table (every legacy table must match; NEW-only tables are listed) …"
collect_row_counts "$OLD_DB_URL" "$OUT_DIR/row_counts_old.txt"
collect_row_counts "$NEW_DB_URL" "$OUT_DIR/row_counts_new.txt"

# Compare over OLD's table list: the clone must carry every live table with an
# identical count. Tables that exist only on NEW are the Phase-2 schema
# (ensembles, sections, memberships, …) and are reported, not failed.
# Legacy objects that Phase 2 retires on PURPOSE. They are gone from NEW by
# design, so their absence is a note, not a failure:
#   public.app_settings — dropped by 018; ensemble_settings.join_code replaces it
#                         (014 moved the row and verified it byte for byte).
RETIRED_TABLES="public.app_settings"

mismatch=0
while IFS='|' read -r tbl oldn; do
  [[ -n "$tbl" ]] || continue
  newn="$(grep -F "$tbl|" "$OUT_DIR/row_counts_new.txt" | head -1 | cut -d'|' -f2 || true)"
  if [[ -z "$newn" ]]; then
    if [[ ",$RETIRED_TABLES," == *",$tbl,"* ]]; then
      log "   retired: $tbl (dropped by migration 018 — replaced by ensemble_settings)"
    else
      warn "   MISSING on NEW: $tbl"
      mismatch=1
    fi
  elif [[ "$newn" != "$oldn" ]]; then
    warn "   MISMATCH $tbl: OLD=$oldn NEW=$newn"
    mismatch=1
  fi
done < "$OUT_DIR/row_counts_old.txt"

new_only="$(comm -13 <(cut -d'|' -f1 "$OUT_DIR/row_counts_old.txt" | sort) \
                     <(cut -d'|' -f1 "$OUT_DIR/row_counts_new.txt" | sort) || true)"
if [[ -n "$new_only" ]]; then
  printf '%s\n' "$new_only" | sed 's/^/    new table: /'
fi

if [[ "$mismatch" == "0" ]]; then
  log "   OK — all $(wc -l < "$OUT_DIR/row_counts_old.txt") legacy tables match exactly."
else
  fail_check "legacy table row counts differ (see the mismatches above)"
fi

# --- 2. auth.users ----------------------------------------------------------
log "2. auth.users count + hash sanity …"
old_users="$(psql "$OLD_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users")"
new_users="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users")"
bad_hash="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from auth.users where encrypted_password is null or encrypted_password = ''")"
log "   OLD=$old_users NEW=$new_users empty-hashes(NEW)=$bad_hash"
[[ "$old_users" == "$new_users" ]] || fail_check "auth.users count differs"
[[ "$bad_hash" == "0" ]] || fail_check "auth.users rows with empty password hashes on NEW"

# --- 3. Attendance history --------------------------------------------------
log "3. Attendance history fingerprint + spot checks …"
old_sum="$(attendance_checksum "$OLD_DB_URL")"
new_sum="$(attendance_checksum "$NEW_DB_URL")"
log "   OLD=$old_sum"
log "   NEW=$new_sum"
[[ "$old_sum" == "$new_sum" ]] || fail_check "attendance fingerprint differs"

SPOT_SQL="select id, event_id, student_id, status, attended, coalesce(checked_in_at::text,'-') from public.attendance_records order by id %s limit 5"
for order in "asc" "desc"; do
  old_rows="$(psql "$OLD_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$(printf "$SPOT_SQL" "$order")")"
  new_rows="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$(printf "$SPOT_SQL" "$order")")"
  if [[ "$old_rows" == "$new_rows" && -n "$old_rows" ]]; then
    log "   OK — spot check (order by id $order) matches."
  elif [[ -z "$old_rows" ]]; then
    log "   (no attendance rows yet — spot check $order skipped)"
  else
    fail_check "attendance spot check (order by id $order) differs"
  fi
done

# --- 4. RLS enabled everywhere ---------------------------------------------
log "4. RLS enabled on every public table (NEW) …"
unprotected="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 <<'SQL'
select n.nspname || '.' || c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by 1;
SQL
)"
if [[ -z "$unprotected" ]]; then
  log "   OK — every public table has RLS enabled."
else
  printf '%s\n' "$unprotected" | sed 's/^/    UNPROTECTED: /'
  fail_check "public tables without RLS on NEW"
fi

# Auth/storage custom objects (same assertions as 03_auth_storage.sh).
for pair in \
  "handle_new_user trigger|select count(*) from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass" \
  "avatars bucket|select count(*) from storage.buckets where id = 'avatars'" \
  "avatar policies|select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars_%'"; do
  label="${pair%%|*}"
  sql="${pair#*|}"

  # The Supabase-Auth signup trigger is retired by 018 (Clerk owns identity and
  # the join-code gate lives in the `user.created` webhook, PLATFORM_PLAN §13).
  # Its absence is only expected once that migration has run — detect it by the
  # retirement of app_settings, which 018 drops in the same file.
  if [[ "$label" == "handle_new_user trigger" ]]; then
    still_legacy="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='app_settings'")"
    if [[ "$still_legacy" == "0" ]]; then
      log "   retired — handle_new_user trigger removed by migration 018 (Clerk owns signup; see PLATFORM_PLAN §13)"
      continue
    fi
  fi

  n="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$sql")"
  min=1
  [[ "$label" == "avatar policies" ]] && min=4
  if [[ "$n" -ge "$min" ]]; then
    log "   OK — $label ($n)"
  else
    fail_check "$label missing on NEW (found $n, expected >= $min)"
  fi
done

# --- 5. Every test suite (each rolls back) -----------------------------------
# Convention: a suite raises on the first violation (ON_ERROR_STOP aborts it) and
# prints a final line containing PASSED. Both are required, so a suite that
# silently stops asserting cannot report success.
log "5. Running every suite in supabase/tests/ against NEW (each rolls back) …"
shopt -s nullglob
suites=("$REPO_ROOT"/supabase/tests/*.sql)
shopt -u nullglob
[[ "${#suites[@]}" -gt 0 ]] || die "No test suites found in supabase/tests/."
for s in "${suites[@]}"; do
  name="$(basename "$s" .sql)"
  suite_log="$OUT_DIR/test_${name}.log"

  # Optional preconditions a suite can declare in its header:
  #   -- requires-table: public.ensembles            (skip until the table exists)
  #   -- requires-nullable-column: events ensemble_id (skip once NOT NULL — the
  #      suite targets the legacy single-program schema and is superseded by its
  #      ensemble-scoped rewrite)
  req_table="$(sed -n '1,25p' "$s" | tr -d '\r' | sed -n 's/^-- requires-table:[[:space:]]*//p' | head -1)"
  if [[ -n "$req_table" ]]; then
    present="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c \
      "select coalesce(to_regclass('${req_table}')::text, 'MISSING')" | tr -d '\r')"
    if [[ "$present" == "MISSING" ]]; then
      log "   SKIP — $name (precondition: ${req_table} exists; not present on this schema yet)"
      continue
    fi
  fi
  # `tr -d '\r'` on both sides: the suite files are CRLF and psql on Windows
  # may emit CR from the query, either of which would silently break the match.
  req="$(sed -n '1,25p' "$s" | tr -d '\r' | sed -n 's/^-- requires-nullable-column:[[:space:]]*//p' | head -1)"
  if [[ -n "$req" ]]; then
    req_tbl="${req%% *}"; req_col="${req##* }"
    nullability="$(psql "$NEW_DB_URL" -X -At -v ON_ERROR_STOP=1 -c \
      "select coalesce((select is_nullable from information_schema.columns
                         where table_schema = 'public' and table_name = '${req_tbl}'
                           and column_name = '${req_col}'), 'MISSING')" | tr -d '\r')"
    if [[ "$nullability" == "NO" ]]; then
      log "   SKIP — $name (precondition: ${req_tbl}.${req_col} nullable; found NOT NULL — superseded by its ensemble-scoped rewrite)"
      continue
    fi
  fi
  # Capture to the log first, then grep it: an early-exiting `grep -q` in a
  # pipeline would SIGPIPE the writer and misreport under `set -o pipefail`.
  if psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$s" > "$suite_log" 2>&1 \
     && grep -qi "PASSED" "$suite_log"; then
    log "   OK — $name (log: out/test_${name}.log)"
  else
    sed 's/^/    /' "$suite_log" >&2
    fail_check "$name did not pass (see out/test_${name}.log)"
  fi
done

# ---------------------------------------------------------------------------
echo
if [[ "$FAILURES" == "0" ]]; then
  log "ALL VERIFICATION CHECKS PASSED — the clone matches. Show this output at the Phase 1 gate."
else
  die "$FAILURES verification check(s) FAILED — do not proceed to Phase 2 until the clone matches."
fi
