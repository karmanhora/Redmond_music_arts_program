#!/usr/bin/env bash
# ============================================================================
# 02_restore.sh — restore the 01_dump.sh output into the NEW project.
# ----------------------------------------------------------------------------
# TARGET: NEW — MODIFIES DATA. Requires explicit confirmation (see below).
#
# Order:
#   1. roles.sql   role definitions (see SKIP_ROLES below)
#   2. reset_public.sql then schema.sql — public schema: tables, RLS, RPCs,
#      triggers (public-only by design — see 01_dump.sh)
#   3. data.sql    all rows with triggers DISABLED
#                  (SET session_replication_role = replica) so handle_new_user
#                  and the notification triggers don't fire while loading.
#   4. reapply_auth_storage.sql — the app's custom objects on Supabase-owned
#      schemas (signup trigger + avatar bucket/policies, idempotent). Runs
#      after data.sql so OLD's avatars bucket row loads before this file's
#      on-conflict-do-nothing insert of the same bucket.
#
# Guards (lib.sh):
#   * Refuses to run when NEW_DB_URL == OLD_DB_URL.
#   * Requires CONFIRM_TARGET=NEW (env) or typing NEW interactively. Anything
#     else aborts. This script can never write to the OLD project.
#
# Rerunnable on the same project: reset_public.sql clears app objects first
# (keeping the platform's rls_auto_enable); roles.sql may
# conflict with roles that already exist (see SKIP_ROLES).
#
# Env: NEW_DB_URL (required), OLD_DB_URL (guard only). Values never printed.
# ============================================================================
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_vars NEW_DB_URL

for f in roles.sql schema.sql data.sql; do
  [[ -s "$OUT_DIR/$f" ]] || die "out/$f missing or empty — run 01_dump.sh first."
done

need_cmd psql "PostgreSQL client"

confirm_target_new "Restore roles.sql + schema.sql + data.sql from scripts/migrate/out/ into NEW_DB_URL."

# ---------------------------------------------------------------------------
# 1. Roles
# ---------------------------------------------------------------------------
if [[ "${SKIP_ROLES:-0}" == "1" ]]; then
  warn "SKIP_ROLES=1 — skipping roles.sql (explicit opt-out)."
else
  log "roles.sql …"
  if ! psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$OUT_DIR/roles.sql"; then
    die "roles.sql failed. Fresh Supabase projects already define the standard roles (anon, authenticated, service_role, …); some CLI versions emit unguarded CREATE ROLE statements. Inspect out/roles.sql, then either edit it or re-run with SKIP_ROLES=1 and note it in the run log."
  fi
fi

# ---------------------------------------------------------------------------
# 2. Schema (public: tables, RLS, RPCs, triggers)
# ---------------------------------------------------------------------------
log "reset_public.sql (drop app objects in public; keeps platform rls_auto_enable) …"
psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATE_DIR/sql/reset_public.sql"

log "schema.sql (public) …"
psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$OUT_DIR/schema.sql"

# ---------------------------------------------------------------------------
# 3. Data — triggers disabled for the load only (session-level setting).
#    Requires a role allowed to set session_replication_role (the `postgres`
#    role on the direct session connection works; the transaction pooler may
#    not — prefer the :5432 direct connection string from Project Settings →
#    Database). If this SET fails with a permission error, re-run using the
#    direct connection string rather than weakening this step.
# ---------------------------------------------------------------------------
log "data.sql (clear old clone rows; session_replication_role = replica → triggers/FK enforcement off) …"
psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "set session_replication_role = replica" \
  -c "delete from storage.objects" \
  -c "delete from storage.buckets" \
  -c "delete from auth.identities" \
  -c "delete from auth.users" \
  -f "$OUT_DIR/data.sql"

# ---------------------------------------------------------------------------
# 4. The app's custom objects on Supabase-owned schemas (auth/storage) are part
#    of its schema but excluded from schema.sql (see 01_dump.sh):
#    handle_new_user + the on_auth_user_created trigger and the avatars bucket
#    + policies. Runs AFTER data.sql: the file is idempotent (guarded inserts /
#    create-or-replace / drop-if-exists), and doing it in this order lets
#    data.sql's COPY of storage.buckets (OLD's avatars bucket) land before the
#    bucket insert instead of colliding with it.
# ---------------------------------------------------------------------------
log "reapply_auth_storage.sql (signup trigger + avatar bucket/policies) …"
psql "$NEW_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATE_DIR/sql/reapply_auth_storage.sql"

log "Restore complete. Next: 03_auth_storage.sh (verify auth/storage objects), then 05_verify.sh."
