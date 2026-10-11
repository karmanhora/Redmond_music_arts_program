-- ============================================================================
-- RHS Music Platform — Migration 028
-- Privacy retention: stale-invite purge + explicit deny policy
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why: `program_invites` (027) stores an invited student's name and email. A
-- pending invitation that is never accepted was retained indefinitely, which is
-- personal information with no retention limit (see docs/privacy/RETENTION_AND_
-- DELETION.md). This migration adds:
--   1. an explicit deny-all policy on `program_invites`, matching the project's
--      "RLS on + explicit deny" convention (015 §9) so the Supabase advisor has
--      nothing to flag — the table was already unreachable (RLS on, all revoked),
--      but this states the intent;
--   2. `purge_stale_program_invites(p_days int default 30)` — deletes
--      unaccepted invitations older than the window. Service-role only; call it
--      from a scheduled job (Supabase Cron / an edge function). Accepted
--      invitations are kept as the historical record of who was added.
--
-- NOTE: this migration is additive and changes no existing behavior on apply.
-- The purge only runs when something calls it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Explicit deny-all policy (defense in depth; table stays service-role only)
-- ---------------------------------------------------------------------------
alter table public.program_invites enable row level security;

drop policy if exists program_invites_no_client_access on public.program_invites;
create policy program_invites_no_client_access on public.program_invites
  for all to authenticated using (false) with check (false);

revoke all on table public.program_invites from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Retention: purge unaccepted invitations older than the window
-- ---------------------------------------------------------------------------
create or replace function public.purge_stale_program_invites(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days    integer := greatest(coalesce(p_days, 30), 1);
  v_deleted integer;
begin
  delete from public.program_invites
   where accepted_at is null
     and created_at < now() - (v_days || ' days')::interval;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

comment on function public.purge_stale_program_invites(integer) is
  'Deletes unaccepted program invitations older than p_days (default 30). Service role only; call from a scheduled job.';

revoke all on function public.purge_stale_program_invites(integer)
  from public, anon, authenticated;
grant execute on function public.purge_stale_program_invites(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- A client must not be able to select from program_invites.
  if has_table_privilege('authenticated', 'public.program_invites', 'SELECT') then
    raise exception 'FAIL: authenticated can SELECT program_invites';
  end if;
  if has_table_privilege('anon', 'public.program_invites', 'SELECT') then
    raise exception 'FAIL: anon can SELECT program_invites';
  end if;

  -- The deny policy exists and the function is service-role only.
  select exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'program_invites'
       and policyname = 'program_invites_no_client_access'
  ) into v_ok;
  if not v_ok then
    raise exception 'FAIL: program_invites_no_client_access policy missing';
  end if;

  if has_function_privilege('authenticated', 'public.purge_stale_program_invites(integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute purge_stale_program_invites()';
  end if;

  raise notice '028 OK: program_invites explicitly denied to clients; stale-invite purge is service-role only';
end
$$;
