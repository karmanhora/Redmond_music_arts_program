-- ============================================================================
-- RHS Music Platform — Migration 019
-- Self-service attendance: a member's own percentage and recent history
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why this exists: the analytics RPCs of 016 are deliberately director-only
-- (PLATFORM_PLAN §12.1), but a student still needs to see *their own*
-- attendance — that is the number the home-screen ring shows. The old app
-- computed it in React (three different ways, one of them wrong), which is the
-- drift 016 set out to remove.
--
-- Both functions are read-only, take the ensemble explicitly, and only ever
-- return the CALLER's own data:
--   * `is_member_of(p_ensemble)` is the whole authorization rule — you can read
--     your own attendance in a program you belong to, and nothing else;
--   * the percentage comes from `attendance_pct_for()` (016), the one shared
--     formula, so a student and their director can never disagree.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. My percentage
-- ---------------------------------------------------------------------------
create or replace function public.my_attendance_pct(p_ensemble uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.is_member_of(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'You are not on this roster.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'percentage', public.attendance_pct_for(p_ensemble, v_me)
  );
end
$$;

comment on function public.my_attendance_pct(uuid) is
  'The caller''s own attendance percentage, using the same formula as the director analytics.';

-- ---------------------------------------------------------------------------
-- 2. My recent required events (newest first)
-- ---------------------------------------------------------------------------
create or replace function public.my_attendance_trend(p_ensemble uuid, p_limit integer DEFAULT 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.is_member_of(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'You are not on this roster.');
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.date desc)
      from (
        select e.id,
               e.name,
               e.event_type,
               e.date,
               coalesce(ar.status::text, 'absent') as status,
               ar.attended,
               ar.checked_in_at
          from public.events e
          left join public.attendance_records ar
                 on ar.event_id = e.id and ar.student_id = v_me
         where e.ensemble_id = p_ensemble
           and e.archived = false
           and e.attendance_requirement = 'required'
           and e.date < now()
         order by e.date desc
         limit greatest(coalesce(p_limit, 0), 0)
      ) x
  ), '[]'::jsonb);
end
$$;

comment on function public.my_attendance_trend(uuid, integer) is
  'The caller''s own past required events with their status, newest first.';

-- ---------------------------------------------------------------------------
-- 3. Grants — members only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.my_attendance_pct(uuid)          from public, anon;
revoke all on function public.my_attendance_trend(uuid, integer) from public, anon;

grant execute on function public.my_attendance_pct(uuid)          to authenticated, service_role;
grant execute on function public.my_attendance_trend(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon text;
begin
  select string_agg(p.proname, ', ')
    into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('my_attendance_pct', 'my_attendance_trend')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon is not null then
    raise exception 'FAIL: anon can execute: %', v_anon;
  end if;

  if to_regprocedure('public.attendance_pct_for(uuid, uuid)') is null then
    raise exception 'FAIL: attendance_pct_for() missing — 016 must be applied first';
  end if;

  raise notice 'self-service attendance OK: my_attendance_pct + my_attendance_trend (members only)';
end
$$;
