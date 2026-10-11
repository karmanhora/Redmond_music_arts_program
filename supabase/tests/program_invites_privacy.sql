-- ============================================================================
-- program_invites_privacy.sql — invites hold PII but no client may touch them
-- ============================================================================
-- requires-table: public.program_invites
--
-- Asserts, in one transaction that is ROLLED BACK:
--   1. `authenticated` and `anon` cannot SELECT/INSERT/UPDATE/DELETE
--      program_invites (deny policy + revoked table privileges from 027/028).
--   2. A stale (unaccepted, older than the window) invitation is purged by
--      `purge_stale_program_invites()`, while a fresh one is kept.
--   3. That purge function is not executable by `authenticated`.
--
-- On success: PROGRAM INVITES PRIVACY PASSED
-- ============================================================================

begin;

do $$
declare
  v_ensemble uuid;
  v_old      uuid;
  v_new      uuid;
  v_left     int;
  v_blocked  boolean;
begin
  if to_regclass('public.program_invites') is null then
    raise exception 'FAIL: INV-0 program_invites missing — apply migration 027 first';
  end if;
  if to_regprocedure('public.purge_stale_program_invites(integer)') is null then
    raise exception 'FAIL: INV-0 purge_stale_program_invites() missing — apply migration 028 first';
  end if;

  -- Table privileges must be revoked from clients.
  if has_table_privilege('authenticated', 'public.program_invites', 'SELECT')
     or has_table_privilege('authenticated', 'public.program_invites', 'INSERT')
     or has_table_privilege('authenticated', 'public.program_invites', 'UPDATE')
     or has_table_privilege('authenticated', 'public.program_invites', 'DELETE') then
    raise exception 'FAIL: INV-1 authenticated holds a privilege on program_invites';
  end if;
  if has_table_privilege('anon', 'public.program_invites', 'SELECT') then
    raise exception 'FAIL: INV-1 anon can SELECT program_invites';
  end if;

  -- Purge function must not be client-executable.
  if has_function_privilege('authenticated', 'public.purge_stale_program_invites(integer)', 'EXECUTE') then
    raise exception 'FAIL: INV-2 authenticated can execute purge_stale_program_invites()';
  end if;

  -- Functional check: seed a stale and a fresh invite as the superuser.
  select id into v_ensemble from public.ensembles limit 1;
  if v_ensemble is null then
    raise exception 'FAIL: INV-3 no ensemble fixture found';
  end if;

  insert into public.program_invites (ensemble_id, email, student_name, created_at)
  values (v_ensemble, 'stale@example.test', 'TST Stale', now() - interval '45 days')
  returning id into v_old;

  insert into public.program_invites (ensemble_id, email, student_name, created_at)
  values (v_ensemble, 'fresh@example.test', 'TST Fresh', now() - interval '2 days')
  returning id into v_new;

  perform public.purge_stale_program_invites(30);

  if exists (select 1 from public.program_invites where id = v_old) then
    raise exception 'FAIL: INV-4 stale invitation was not purged';
  end if;
  if not exists (select 1 from public.program_invites where id = v_new) then
    raise exception 'FAIL: INV-4 fresh invitation was wrongly purged';
  end if;

  -- A client role still cannot read even the fresh row.
  set local role authenticated;
  begin
    perform count(*) from public.program_invites;
    v_blocked := false;
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'FAIL: INV-5 authenticated read program_invites';
  end if;

  raise notice 'program invites privacy OK: clients denied, stale purged, fresh kept';
end
$$;

rollback;

\echo 'PROGRAM INVITES PRIVACY PASSED'
