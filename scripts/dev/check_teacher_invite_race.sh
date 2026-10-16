#!/usr/bin/env bash
# ============================================================================
# check_teacher_invite_race.sh — two real connections, one invitation code
# ----------------------------------------------------------------------------
# Why this is not a SQL suite: `supabase/tests/*.sql` each run inside ONE
# transaction, so they cannot produce the thing that matters here — a second
# session that is *actually* blocked on the first session's row lock while both
# try to redeem the same code.
#
# The suite (teacher_invitations.sql, TI-4) pins down the shape that makes the
# race safe (the guard lives in the UPDATE's own predicate, plus a partial unique
# index one live redemption per account). This script proves the behaviour: two
# psql clients start together, sleep past each other's start, and both attempt
# the redemption of the same code in overlapping transactions. Exactly one may
# come back ok=true, and exactly one row may end up redeemed.
#
# READ-ONLY with respect to Supabase: it never reads .env and only ever connects
# to the local PostgreSQL in .tools/pgsql, against the database
# `scripts/dev/verify_migrations_locally.sh` leaves behind. Run that first.
#
#   bash scripts/dev/verify_migrations_locally.sh
#   bash scripts/dev/check_teacher_invite_race.sh
#
# Exits non-zero unless exactly one session wins.
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
# This environment's default client encoding is not UTF-8, and psql then refuses
# the UTF-8 bytes in some migrations.
export PGCLIENTENCODING=UTF8
export PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres

if ! pg_isready -q 2>/dev/null; then
  echo "Local PostgreSQL is not running — run scripts/dev/verify_migrations_locally.sh first." >&2
  exit 1
fi

if ! psql -q -X -d "$DB" -c 'select 1 from public.teacher_invitations limit 1' >/dev/null 2>&1; then
  echo "SKIP: $DB has no public.teacher_invitations — run scripts/dev/verify_migrations_locally.sh first." >&2
  exit 1
fi

# A code the operators of this repository already know: this is a throwaway
# local database, and the row is removed again below.
CODE='TI-RACE-ONLY-CODE'
SUB_A='035e0000-0000-4000-8000-0000000000a1'
SUB_B='035e0000-0000-4000-8000-0000000000b2'

cleanup() {
  psql -q -X -d "$DB" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
delete from public.teacher_invitations where code_hash = public.invitation_code_hash('$CODE');
delete from public.teacher_invite_attempts where auth_user_id in ('$SUB_A', '$SUB_B');
delete from public.signup_account_types where auth_user_id in ('$SUB_A', '$SUB_B');
SQL
}
trap cleanup EXIT
cleanup
cleanup   # idempotent, and clears anything a previous run left behind

psql -q -X -d "$DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.teacher_invitations (code_hash, label)
values (public.invitation_code_hash('$CODE'), 'local concurrency check');
SQL

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; cleanup' EXIT

# One session's whole story: authenticate the way PostgREST would, wait for the
# other session to arrive, redeem, hold the row lock briefly, then commit.
race() {
  local sub="$1" out="$2"
  psql -q -X -d "$DB" -t -A -v ON_ERROR_STOP=1 -c "
    begin;
    select set_config('request.jwt.claims', '{\"sub\":\"${sub}\",\"role\":\"authenticated\"}', true);
    select pg_sleep(0.4);
    select 'RESULT=' || coalesce(public.redeem_teacher_invitation('${CODE}') ->> 'ok', 'null');
    select pg_sleep(0.6);
    commit;" > "$out" 2>&1
}

echo "=== racing two sessions for one code ==="
race "$SUB_A" "$WORK/a.out" &
PID_A=$!
race "$SUB_B" "$WORK/b.out" &
PID_B=$!
wait "$PID_A"; RC_A=$?
wait "$PID_B"; RC_B=$?

OUT_A="$(grep -o 'RESULT=[a-z]*' "$WORK/a.out" | tail -1 || true)"
OUT_B="$(grep -o 'RESULT=[a-z]*' "$WORK/b.out" | tail -1 || true)"
WINNERS=0
[[ "$OUT_A" == 'RESULT=true' ]] && WINNERS=$((WINNERS + 1))
[[ "$OUT_B" == 'RESULT=true' ]] && WINNERS=$((WINNERS + 1))

echo "session A: rc=$RC_A ${OUT_A:-<no result>}"
echo "session B: rc=$RC_B ${OUT_B:-<no result>}"
[[ "$RC_A" -eq 0 && "$RC_B" -eq 0 ]] || { echo "FAIL: a racing session errored"; sed 's/^/       /' "$WORK/a.out" "$WORK/b.out"; exit 1; }

REDEEMED="$(psql -q -X -d "$DB" -t -A -c "
  select count(*) from public.teacher_invitations
   where code_hash = public.invitation_code_hash('$CODE') and redeemed_at is not null;")"
ROWS="$(psql -q -X -d "$DB" -t -A -c "
  select count(*) from public.teacher_invitations where code_hash = public.invitation_code_hash('$CODE');")"
HOLDERS="$(psql -q -X -d "$DB" -t -A -c "
  select count(*) from public.teacher_invitations
   where code_hash = public.invitation_code_hash('$CODE')
     and redeemed_by_auth is not null;")"

FAILED=0
[[ "$WINNERS" -eq 1 ]] || { echo "FAIL: expected exactly one winning session, got $WINNERS"; FAILED=1; }
[[ "$ROWS" -eq 1 ]] || { echo "FAIL: expected one invitation row, got $ROWS"; FAILED=1; }
[[ "$REDEEMED" -eq 1 ]] || { echo "FAIL: expected exactly one redeemed row, got $REDEEMED"; FAILED=1; }
[[ "$HOLDERS" -eq 1 ]] || { echo "FAIL: expected exactly one redeemed_by_auth, got $HOLDERS"; FAILED=1; }

if [[ $FAILED -eq 0 ]]; then
  # The loser must also hold no access, and the winner must hold it.
  LOSER_SUB="$SUB_B"; [[ "$OUT_B" == 'RESULT=true' ]] && LOSER_SUB="$SUB_A"
  WINNER_SUB="$SUB_A"; [[ "$LOSER_SUB" == "$SUB_A" ]] && WINNER_SUB="$SUB_B"

  LOSER="$(psql -q -X -d "$DB" -t -A -c "
    select set_config('request.jwt.claims', '{\"sub\":\"$LOSER_SUB\",\"role\":\"authenticated\"}', true);
    select public.has_teacher_access();" | tail -1)"
  WINNER="$(psql -q -X -d "$DB" -t -A -c "
    select set_config('request.jwt.claims', '{\"sub\":\"$WINNER_SUB\",\"role\":\"authenticated\"}', true);
    select public.has_teacher_access();" | tail -1)"

  [[ "$LOSER" == 'f' ]] || { echo "FAIL: the losing session ended up with teacher access ($LOSER)"; FAILED=1; }
  [[ "$WINNER" == 't' ]] || { echo "FAIL: the winning session did not get teacher access ($WINNER)"; FAILED=1; }
  echo "one winner, one refusal, one redeemed row; winner verified, loser denied"
fi

[[ $FAILED -eq 0 ]] || exit 1
echo
echo "TEACHER INVITE RACE PASSED"
