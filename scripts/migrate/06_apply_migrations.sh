#!/usr/bin/env bash
# ============================================================================
# 06_apply_migrations.sh — apply supabase/migrations/*.sql to the NEW project.
# ----------------------------------------------------------------------------
# TARGET: NEW — MODIFIES DATA (except --dry-run, which rolls everything back).
#
# Migrations are applied in lexical filename order, which IS dependency order
# (007 → 018). One transaction: either the whole batch lands or nothing does.
#
# Usage:
#   bash scripts/migrate/06_apply_migrations.sh --dry-run [--with-tests]
#       Rehearse: applies every migration and (optionally) every test suite in a
#       transaction that is ROLLED BACK. Nothing persists. No confirmation
#       needed — this is the safe way to validate new SQL before applying it.
#   CONFIRM_TARGET=NEW bash scripts/migrate/06_apply_migrations.sh
#       Apply for real (single transaction, ON_ERROR_STOP=1).
#
# Tests are run by 05_verify.sh against the applied database; --with-tests
# exists purely so a rehearsal can prove migrations + suites together.
#
# Env: NEW_DB_URL (required). Values never printed.
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_vars NEW_DB_URL

DRY_RUN=0
WITH_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --with-tests) WITH_TESTS=1 ;;
    -h|--help)    sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)            die "Unknown option: $arg (see --help)" ;;
  esac
done

[[ "$WITH_TESTS" == "0" || "$DRY_RUN" == "1" ]] \
  || die "--with-tests is only valid with --dry-run; 05_verify.sh runs the suites against the applied database."

need_cmd psql "PostgreSQL client"

MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
TESTS_DIR="$REPO_ROOT/supabase/tests"

mapfile -t MIGRATIONS < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print | sort)
[[ "${#MIGRATIONS[@]}" -gt 0 ]] || die "No migrations found in supabase/migrations/."

# Build one script by CONCATENATION, not \i: the psql here is the Windows
# build, which cannot resolve MSYS-style paths (/c/...). Concatenation also
# keeps the whole batch in one transaction. Migrations are plain SQL (no
# path-relative meta-commands), so nothing is lost.
SCRIPT="$OUT_DIR/apply_migrations.sql"
mkdir -p "$OUT_DIR"
: > "$SCRIPT"
for f in "${MIGRATIONS[@]}"; do
  printf '\n\\echo === %s\n' "$(basename "$f")" >> "$SCRIPT"
  cat "$f" >> "$SCRIPT"
  printf '\n' >> "$SCRIPT"
done

if [[ "$WITH_TESTS" == "1" ]]; then
  shopt -s nullglob
  SUITE_N=0
  for t in "$TESTS_DIR"/*.sql; do
    # Suites that declare a legacy-schema precondition (see 05_verify.sh) are
    # skipped here: they target the PRE-migration clone, which is exactly what
    # 05_verify.sh runs them against at the Phase 1 gate. Everything else in
    # this directory is exercised against the migrated schema in this rehearsal.
    if sed -n '1,25p' "$t" | tr -d '\r' | grep -q '^-- requires-nullable-column:'; then
      printf '\n\\echo === test: %s SKIPPED (legacy-schema precondition; run by 05_verify.sh against the un-migrated clone)\n' "$(basename "$t")" >> "$SCRIPT"
      continue
    fi
    SUITE_N=$((SUITE_N + 1))
    # Suites wrap themselves in BEGIN…ROLLBACK so they are safe standalone
    # (`psql -f <suite>`). Inside this rehearsal the OUTER transaction provides
    # that isolation, and a nested ROLLBACK would end it early — letting every
    # later statement auto-commit into NEW. So the wrapper lines are stripped
    # here, and each suite instead runs inside its own SAVEPOINT so its fixtures
    # (and any SET ROLE / request.jwt.claims) cannot leak into the next suite.
    printf '\n\\echo === test: %s\nsavepoint suite_%d;\n' "$(basename "$t")" "$SUITE_N" >> "$SCRIPT"
    grep -viE '^[[:space:]]*(begin|rollback)[[:space:]]*;' "$t" >> "$SCRIPT" || true
    printf '\nrollback to savepoint suite_%d;\n' "$SUITE_N" >> "$SCRIPT"
  done
  shopt -u nullglob
fi

# Safety: no stray transaction terminator may survive in the body, or the
# rehearsal could commit instead of rolling back.
if grep -qiE '^[[:space:]]*rollback[[:space:]]*;' "$SCRIPT"; then
  die "Refusing to rehearse: a top-level 'rollback;' survived inside the body — it would end the transaction early."
fi

log "$(printf '%s ' "${#MIGRATIONS[@]}")migration(s) queued: $(basename -a "${MIGRATIONS[@]}" | tr '\n' ' ')"

if [[ "$DRY_RUN" == "1" ]]; then
  banner "TARGET: NEW — DRY RUN (everything below is ROLLED BACK)" \
         "Rehearsing migrations${WITH_TESTS:+ (and test suites)}; nothing persists."
  REHEARSAL="$OUT_DIR/apply_migrations.rehearsal.sql"
  { echo 'begin;'; cat "$SCRIPT"; echo 'rollback;'; } > "$REHEARSAL"
  if psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$REHEARSAL"; then
    log "Rehearsal PASSED — migrations${WITH_TESTS:+ + tests} apply cleanly and roll back."
  else
    die "Rehearsal FAILED — see the output above; nothing was committed."
  fi
  exit 0
fi

confirm_target_new "Apply $(printf '%s ' "${#MIGRATIONS[@]}")migration(s) from supabase/migrations/ to NEW_DB_URL in one transaction."

psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f "$SCRIPT"

log "Migrations applied. Next: 05_verify.sh (counts, RLS, test suites), then 03b Clerk import when its gate opens."
