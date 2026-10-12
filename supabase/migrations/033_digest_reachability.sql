-- ============================================================================
-- RHS Music Platform — Migration 033
-- Who will actually receive the upcoming-events email, and why the rest will not
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why: 032 made the digest possible and is deliberately quiet about the people it
-- skips. Every exclusion there is correct on its own — an unconfirmed address is
-- not one we were given permission to use, a member may turn the email off — but
-- the effect is that a program can be *entirely* unreachable and nobody finds out
-- until the emails fail to arrive. A director cannot see `auth.users`, so they
-- cannot see the difference between "no events" and "nobody can be mailed".
-- `digest_reachability()` answers that question for one program, in the same
-- terms the digest itself uses.
--
-- The one boundary this keeps: it never returns an address. It reports the
-- *state* of an address — present and confirmed, present and unconfirmed, absent
-- — which is why it can be staff-only rather than service-role-only like
-- `due_event_digests()` (032). The reasons are the filters of that function in
-- the same order, so a label here and a silent skip there cannot disagree:
--
--   opted_out            memberships.email_upcoming_events is false — their call.
--   no_sign_in           nothing behind the roster row can receive mail: either
--                        `profiles.auth_user_id` is null (never signed in — a
--                        restored or invited person), or it points at an
--                        `auth.users` row that no longer exists (a cloned link
--                        whose account did not come across). Both are the same
--                        answer to "can we mail them?" — no — and a director
--                        needs no more than that.
--   no_address           the account has no email on it.
--   unconfirmed          the address exists but was never confirmed.
--   account_deactivated  profiles.deactivated — a deactivated account is muted.
--   reachable            none of the above: this person gets the email.
--
-- Two conditions are about the program rather than a person, so they come back
-- as their own fields: an archived program sends nothing (`program_active`), and
-- a week with no events sends nothing (`events`).
--
-- No existing behaviour changes on apply: this function only reads.
-- ============================================================================

create or replace function public.digest_reachability(
  p_ensemble uuid,
  p_days     integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_profile   uuid := public.current_profile_id();
  v_days      integer;
  v_from      timestamptz := now();
  v_to        timestamptz;
  v_active    boolean;
  v_events    integer;
  v_members   integer;
  v_reachable integer;
  v_people    jsonb;
begin
  -- Staff of this program only. Knowing which of your classmates cannot be mailed
  -- is staff information about other people, and the message says so rather than
  -- pretending the program is empty.
  if v_profile is null or not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object(
      'ok', false,
      'message', 'Only this program''s staff can see who receives the email.'
    );
  end if;

  -- Same clamp as the sender: a window is a number of days, not a request.
  v_days := least(greatest(coalesce(p_days, 7), 1), 30);
  v_to   := v_from + make_interval(days => v_days);

  select e.active into v_active from public.ensembles e where e.id = p_ensemble;
  if v_active is null then
    return jsonb_build_object('ok', false, 'message', 'That program does not exist.');
  end if;

  select count(*) into v_events
    from public.events ev
   where ev.ensemble_id = p_ensemble
     and not ev.archived
     and ev.date >= v_from
     and ev.date <  v_to;

  -- One row per active member, labelled with the first reason the digest would
  -- skip them — evaluated in the order `due_event_digests()` applies its filters,
  -- with the member's own choice first because it is the one nobody has to fix.
  with roster as (
    select m.user_id,
           case
             when not m.email_upcoming_events  then 'opted_out'
             when u.id is null                 then 'no_sign_in'
             when coalesce(u.email, '') = ''   then 'no_address'
             when u.email_confirmed_at is null then 'unconfirmed'
             when p.deactivated                then 'account_deactivated'
             else 'reachable'
           end as status
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      -- Left, not inner: a member with no account is exactly what this reports.
      left join auth.users u on u.id::text = p.auth_user_id
     where m.ensemble_id = p_ensemble
       and m.active
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('user_id', r.user_id, 'status', r.status)
             order by r.user_id
           ),
           '[]'::jsonb
         ),
         count(*),
         count(*) filter (where r.status = 'reachable')
    into v_people, v_members, v_reachable
    from roster r;

  return jsonb_build_object(
    'ok',             true,
    'window_days',    v_days,
    'program_active', v_active,
    'events',         v_events,
    'members',        v_members,
    'reachable',      v_reachable,
    'people',         v_people
  );
end
$$;

comment on function public.digest_reachability(uuid, integer) is
  'Per active member of one program: whether the scheduled upcoming-events email will reach them and, when it will not, why (opted_out / no_sign_in / no_address / unconfirmed / account_deactivated), plus the window''s event count and whether the program is active. Returns no addresses, so staff of the program may call it; every other caller is refused.';

revoke all on function public.digest_reachability(uuid, integer) from public, anon;
grant execute on function public.digest_reachability(uuid, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.digest_reachability(uuid, integer)') is null then
    raise exception 'FAIL: digest_reachability() was not created';
  end if;

  -- It reads auth.users and the roster of other people, so it must not run as
  -- the caller.
  if not (select prosecdef
            from pg_proc
           where oid = 'public.digest_reachability(uuid, integer)'::regprocedure) then
    raise exception 'FAIL: digest_reachability() is not SECURITY DEFINER';
  end if;

  if has_function_privilege('anon', 'public.digest_reachability(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute digest_reachability()';
  end if;
  if has_function_privilege('public', 'public.digest_reachability(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: PUBLIC can execute digest_reachability()';
  end if;
  if not has_function_privilege('authenticated',
       'public.digest_reachability(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute digest_reachability()';
  end if;
  if not has_function_privilege('service_role',
       'public.digest_reachability(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot execute digest_reachability()';
  end if;

  raise notice '033 OK: digest_reachability() names each member''s reason for being skipped, returns no addresses, and is staff-only';
end
$$;
