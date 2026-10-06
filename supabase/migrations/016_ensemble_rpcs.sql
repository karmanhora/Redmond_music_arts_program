-- ============================================================================
-- RHS Music Platform — Migration 016
-- Ensemble-aware RPCs (the write path)
-- ============================================================================
-- Idempotent — safe to re-run. Every function is dropped and recreated, so a
-- re-run can never leave a half-old signature behind.
--
-- What this changes: every RPC from PLATFORM_PLAN §2.2 F4–F12 rewritten onto
-- the 013/015 helpers. Identity is `current_profile_id()` (never `auth.uid()`),
-- every rule is evaluated *inside the program the row belongs to*, and every
-- aggregate is scoped to one program.
--
-- RENAME MAP (the frontend is rebuilt in Phase 3b against these):
--   get_band_join_code()                  → get_join_code(p_ensemble uuid)
--   set_band_join_code(p_code)            → set_join_code(p_ensemble uuid, p_code)
--   get_band_join_code_status()           → get_join_code_status(p_slug)
--   validate_band_join_code(p_code)       → validate_join_code(p_slug, p_code[, p_ip])
--   deactivate_member(p_member_id)        → deactivate_member(p_ensemble, p_member_id)
--   reactivate_member(p_member_id)        → reactivate_member(p_ensemble, p_member_id)
--   update_member_instrument(id, text)    → set_member_section(p_ensemble, p_member_id, p_section_id)
--   get_student_attendance_pct(student)   → get_student_attendance_pct(student, p_ensemble)
--   get_section_attendance_stats()        → get_section_attendance_stats(p_ensemble)
--   get_attendance_trend(limit)           → get_attendance_trend(p_ensemble, limit)
--   sync_google_calendar_events(...)      → 3-arg form, see 017_calendar_sync.sql
-- Signatures that do NOT change (the frontend keeps calling them as-is):
--   start_checkin_session(p_event_id), record_attendance(p_token),
--   record_attendance_by_code(p_code), override_attendance(...),
--   get_event_attendance_summary(p_event_id) — the program is derived from the
--   event, which is strictly safer than trusting a client-supplied id.
--
-- RETIRED HERE (no longer meaningful once Clerk owns accounts, PLATFORM_PLAN §13):
--   invite_member / invite_member_one / invite_members_bulk
--       → the `invite_member` Edge Function (Clerk BAPI CreateUser + service-role
--         inserts). The RPCs created `auth.users` rows directly, which Clerk
--         users could never sign in as.
--   reset_member_password()      → Clerk BAPI password reset.
--   get_roster_emails()          → emails live in Clerk; the reminder edge
--                                   function reads them from the Clerk BAPI.
--   (deactivate/reactivate keep their DB side here; the matching Clerk
--    BanUser/UnbanUser call lives in the edge functions.)
--
-- New: `register_signup(...)` — the DB side of the Clerk `user.created` webhook:
-- the join-code gate, profiles + memberships, idempotent by `clerk_id`.
-- New: `attendance_pct_for(ensemble, student)` — ONE percentage formula, shared
-- by the student, section and roster analytics (fixes the drift between the
-- three hand-rolled variants in the old UI).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Retire the account-creating / legacy-identity RPCs
-- ---------------------------------------------------------------------------
drop function if exists public.invite_member(text, text, text);
drop function if exists public.invite_member_one(text, text, text);
drop function if exists public.invite_members_bulk(jsonb);
drop function if exists public.reset_member_password(uuid);
drop function if exists public.get_roster_emails();
drop function if exists public.update_member_instrument(uuid, text);
drop function if exists public.get_band_join_code();
drop function if exists public.set_band_join_code(text);
drop function if exists public.get_band_join_code_status();
drop function if exists public.validate_band_join_code(text);
drop function if exists public.deactivate_member(uuid);
drop function if exists public.reactivate_member(uuid);
drop function if exists public.get_student_attendance_pct(uuid);
drop function if exists public.get_section_attendance_stats();
drop function if exists public.get_attendance_trend(integer);

-- ---------------------------------------------------------------------------
-- 1. Join codes — per program, stored in `ensemble_settings`
-- ---------------------------------------------------------------------------

create or replace function public.get_join_code(p_ensemble uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can view the join code.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', coalesce(
      (select s.join_code from public.ensemble_settings s where s.ensemble_id = p_ensemble),
      ''
    )
  );
end
$$;

create or replace function public.set_join_code(p_ensemble uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := left(trim(coalesce(p_code, '')), 64);
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can change the join code.');
  end if;

  insert into public.ensemble_settings (ensemble_id, join_code)
  values (p_ensemble, v_code)
  on conflict (ensemble_id) do update set join_code = excluded.join_code;

  return jsonb_build_object('ok', true, 'message', 'Join code updated.');
end
$$;

-- Public-ish (any signed-in user, any program): reveals nothing but whether a
-- join code is set. Deliberately NOT granted to `anon` — under Clerk the
-- sign-up form always shows the code field and the gate is enforced by the
-- `user.created` webhook (PLATFORM_PLAN §13.2).
create or replace function public.get_join_code_status(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'enabled', coalesce(
      (select s.join_code
         from public.ensembles e
         left join public.ensemble_settings s on s.ensemble_id = e.id
        where e.slug = p_slug
          and e.active),
      ''
    ) <> ''
  )
$$;

-- The rate-limited join-code gate. `p_ip` lets the edge function pass the real
-- caller IP (the webhook's own x-forwarded-for is Clerk's, not the student's).
create or replace function public.validate_join_code(p_slug text, p_code text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip       text := coalesce(nullif(trim(coalesce(p_ip, '')), ''), public.client_ip());
  v_required text;
  v_ok       boolean;
begin
  select coalesce(s.join_code, '')
    into v_required
    from public.ensembles e
    left join public.ensemble_settings s on s.ensemble_id = e.id
   where e.slug = p_slug
     and e.active;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'That program isn''t available.');
  end if;

  v_ok := v_required = '' or upper(coalesce(p_code, '')) = upper(v_required);

  -- Lockout: too many recent failures from this IP → refuse, even if the code
  -- happens to be right now, so the throttled caller can't trivially bypass.
  if (select count(*) from public.join_code_attempts
       where ip = v_ip
         and success = false
         and created_at > now() - interval '2 minutes') >= 5 then
    insert into public.join_code_attempts (ip, success) values (v_ip, false);
    return jsonb_build_object(
      'ok', false,
      'message', 'Too many attempts — try again in a minute.'
    );
  end if;

  insert into public.join_code_attempts (ip, success) values (v_ip, v_ok);

  if v_ok then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object(
    'ok', false,
    'message', 'That band join code isn''t right — ask your director for the current one.'
  );
end
$$;

-- The DB side of the Clerk `user.created` webhook (§13.2): validate the join
-- code, then create `profiles` + `memberships`. Idempotent by `clerk_id`, so a
-- redelivered webhook is a no-op. An unknown/wrong code deliberately creates
-- NOTHING — the account exists in Clerk with no profile, which lands the user
-- on the unchanged "Not on the roster" screen.
create or replace function public.register_signup(
  p_clerk_id     text,
  p_full_name    text,
  p_slug         text,
  p_join_code    text,
  p_section_name text default '',
  p_ip           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ensemble uuid;
  v_existing uuid;
  v_profile  uuid;
  v_section  uuid;
  v_check    jsonb;
begin
  if coalesce(trim(p_clerk_id), '') = '' then
    return jsonb_build_object('ok', false, 'message', 'Missing Clerk user id.');
  end if;

  select id into v_ensemble
    from public.ensembles
   where slug = p_slug
     and active;
  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'That program isn''t available.');
  end if;

  -- Idempotency: a profile for this Clerk user already exists.
  select id into v_existing from public.profiles where clerk_id = p_clerk_id;
  if v_existing is not null then
    select s.id into v_section
      from public.sections s
     where s.ensemble_id = v_ensemble
       and s.name = trim(coalesce(p_section_name, ''))
     limit 1;

    insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
    values (v_existing, v_ensemble, v_section, '{student}'::public.app_role[], true)
    on conflict (user_id, ensemble_id) do nothing;

    return jsonb_build_object('ok', true, 'profile_id', v_existing, 'existing', true);
  end if;

  -- The join-code gate (same rate-limited logic as validate_join_code).
  v_check := public.validate_join_code(p_slug, p_join_code, p_ip);
  if coalesce(v_check ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_check ->> 'message', 'That join code isn''t right.')
    );
  end if;

  v_profile := gen_random_uuid();

  insert into public.profiles (id, clerk_id, full_name, display_name)
  values (v_profile, trim(p_clerk_id), coalesce(p_full_name, ''), coalesce(p_full_name, ''));

  select s.id into v_section
    from public.sections s
   where s.ensemble_id = v_ensemble
     and s.name = trim(coalesce(p_section_name, ''))
   limit 1;

  insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
  values (v_profile, v_ensemble, v_section, '{student}'::public.app_role[], true);

  return jsonb_build_object('ok', true, 'profile_id', v_profile);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Member management — roster changes only. Account lifecycle (create, ban,
--    password reset) belongs to the Clerk-backed edge functions (§13.2);
--    these RPCs only ever touch `memberships` + `profiles`.
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_member(p_ensemble uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can deactivate members.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_member_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if public.is_director_anywhere(p_member_id) and not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot deactivate another director.');
  end if;

  update public.memberships
     set active = false
   where user_id = p_member_id
     and ensemble_id = p_ensemble;

  -- Person-level flag mirrors "no active membership anywhere": with more than
  -- one program later, pausing band must not lock an orchestra member out.
  -- The matching Clerk ban/unban is applied by the edge function.
  update public.profiles p
     set deactivated = not exists (
       select 1 from public.memberships m
        where m.user_id = p.id and m.active
     )
   where p.id = p_member_id;

  return jsonb_build_object('ok', true, 'message', 'Member deactivated — they can no longer sign in.');
end
$$;

create or replace function public.reactivate_member(p_ensemble uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can reactivate members.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_member_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if public.is_director_anywhere(p_member_id) and not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot reactivate another director.');
  end if;

  update public.memberships
     set active = true
   where user_id = p_member_id
     and ensemble_id = p_ensemble;

  update public.profiles
     set deactivated = false
   where id = p_member_id;

  return jsonb_build_object('ok', true, 'message', 'Member reactivated — they can sign in again.');
end
$$;

-- Replaces `update_member_instrument`: the section is a row in `sections`, not
-- a free-text string. Directors move anyone in their program; a member may move
-- themselves (today's Profile screen does exactly that).
create or replace function public.set_member_section(p_ensemble uuid, p_member_id uuid, p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.can_manage_ensemble(p_ensemble) or p_member_id = v_actor) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can change another member''s section.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_member_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;
  if p_section_id is not null and not exists (
    select 1 from public.sections
     where id = p_section_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That section belongs to a different program.');
  end if;
  if p_member_id <> v_actor
     and public.is_director_anywhere(p_member_id)
     and not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot change another director''s section.');
  end if;

  update public.memberships
     set section_id = p_section_id
   where user_id = p_member_id
     and ensemble_id = p_ensemble;

  return jsonb_build_object('ok', true, 'message', 'Section updated.');
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Check-in — the program comes from the event, never from the caller.
-- ---------------------------------------------------------------------------

create or replace function public.start_checkin_session(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public.current_profile_id();
  v_event   public.events%rowtype;
  v_token   text;
  v_entry   text;
  v_expires timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to generate a code.');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That event no longer exists.');
  end if;

  -- Staff of *this* program: director, secretary (or program admin), plus
  -- section leaders — matching today's behavior (v1 sessions are program-wide).
  if not (
    public.is_ensemble_staff(v_event.ensemble_id)
    or public.has_role_in(v_event.ensemble_id, 'section_leader')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Only directors, secretaries and section leaders can generate codes.');
  end if;

  if v_event.checkin_mode = 'toggle' then
    return jsonb_build_object('ok', false, 'message', 'This event uses toggle check-in — mark attendance with the buttons on the Check-In screen.');
  end if;
  if v_event.checkin_mode = 'none' then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t collect attendance.');
  end if;
  if now() > coalesce(v_event.end_date, v_event.date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — check-in is closed.');
  end if;
  if now() < v_event.date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in opens 15 minutes before the event.');
  end if;

  delete from public.checkin_sessions where event_id = p_event_id;

  v_entry := (
    select string_agg(
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
    from generate_series(1, 8)
  );

  insert into public.checkin_sessions (event_id, created_by, token, entry_code, expires_at)
  values (
    p_event_id,
    v_uid,
    encode(gen_random_bytes(24), 'hex'),
    v_entry,
    now() + interval '5 minutes'
  )
  returning token, entry_code, expires_at into v_token, v_entry, v_expires;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'entry_code', v_entry,
    'expires_at', v_expires
  );
end
$$;

-- Shared by the QR (token) and manual (code) paths. Everything that follows the
-- session lookup — the rate limit, the QR window, the mode check, the ended /
-- not-open-yet windows, the excused protection, first-check-in-wins and the
-- status ⟺ attended invariant — is identical in both, so it lives here once.
create or replace function public.record_checkin_for_session(p_session_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   record;
  v_record    public.attendance_records%rowtype;
  v_event_id  uuid;
  v_attempt   uuid;
  v_is_late   boolean := false;
  v_status    text;
  v_late_mins int;
begin
  if p_actor is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select cs.id, cs.event_id, cs.expires_at,
         ev.name as event_name, ev.date as event_date, ev.end_date as event_end,
         ev.late_minutes, ev.checkin_mode, ev.ensemble_id
    into v_session
    from public.checkin_sessions cs
    join public.events ev on ev.id = cs.event_id
   where cs.id = p_session_id
   limit 1;

  v_event_id := v_session.event_id;

  -- Directors run the band; they don't check in — evaluated in the event's
  -- program, so a director of one program can still check into another. Both
  -- of these come before the rate limiter, so a staff mis-tap never burns an
  -- attempt against a student's bucket.
  if v_session.id is not null then
    if public.has_role_in(v_session.ensemble_id, 'director') then
      return jsonb_build_object('ok', false, 'message', 'Directors don''t check in.');
    end if;
    if not public.is_member_of(v_session.ensemble_id) then
      return jsonb_build_object('ok', false, 'message', 'You are not on this roster.');
    end if;
  end if;

  -- Rate limit: more than 5 failed attempts for this event (or the unknown-code
  -- bucket) in the last 2 minutes → refuse.
  if (select count(*) from public.checkin_attempts
       where actor_id = p_actor
         and event_id is not distinct from v_event_id
         and success = false
         and created_at > now() - interval '2 minutes') >= 5 then
    insert into public.checkin_attempts (event_id, actor_id, success)
    values (v_event_id, p_actor, false);
    return jsonb_build_object('ok', false, 'message', 'Too many attempts — try again in a minute.');
  end if;

  insert into public.checkin_attempts (event_id, actor_id, success)
  values (v_event_id, p_actor, false)
  returning id into v_attempt;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'message', 'That code was not recognized.');
  end if;

  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has expired — ask for a fresh one.');
  end if;

  -- A QR token only works while the event still collects attendance via QR.
  -- This kills tokens whose event was switched to toggle/none even if the
  -- session row somehow survived the invalidation trigger.
  if v_session.checkin_mode not in ('qr', 'both') then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t use QR check-in.');
  end if;

  -- Attendance is only accepted while the event is happening. Once it's over,
  -- the code is dead even if it's still unexpired — no retroactive check-ins.
  if now() > coalesce(v_session.event_end, v_session.event_date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — attendance is closed.');
  end if;

  -- Check-in opens 15 minutes before the event start; earlier scans are
  -- rejected with a clear message (enforced here, not in React).
  if now() < v_session.event_date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in has not opened yet.');
  end if;

  -- A staff-set excuse is final: don't let a scan overwrite it.
  if exists (
    select 1 from public.attendance_records ar
     where ar.event_id = v_session.event_id
       and ar.student_id = p_actor
       and ar.status = 'excused'
  ) then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  v_late_mins := coalesce(v_session.late_minutes, 10);
  if v_session.event_date + (v_late_mins || ' minutes')::interval < now() then
    v_is_late := true;
    v_status := 'late';
  else
    v_status := 'present';
  end if;

  insert into public.attendance_records (
    event_id, student_id, attended, checked_in_at, status, is_late
  )
  values (
    v_session.event_id, p_actor, true, now(), v_status, v_is_late
  )
  on conflict (event_id, student_id)
  do update set
    -- First check-in wins: keep an existing present/late status, lateness flag
    -- and timestamp. Anything else (legacy 'absent' rows) is upgraded to this
    -- check-in's status so status and attended can never disagree.
    status = case
      when attendance_records.status in ('present', 'late') then attendance_records.status
      else excluded.status
    end,
    is_late = case
      when attendance_records.status in ('present', 'late') then attendance_records.is_late
      else excluded.is_late
    end,
    attended = true,
    checked_in_at = case
      when attendance_records.status in ('present', 'late')
        then coalesce(attendance_records.checked_in_at, now())
      else now()
    end
  returning * into v_record;

  update public.checkin_attempts set success = true where id = v_attempt;

  -- Defend the invariant even against a lost race with a concurrent excuse:
  -- the row must never be excused + attended = true.
  if v_record.status = 'excused' then
    return jsonb_build_object('ok', false, 'message', 'You''ve been excused for this event — no check-in needed.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case when v_record.status = 'late' then 'Checked in (late)' else 'Checked in' end,
    'event_id', v_session.event_id,
    'event_name', v_session.event_name,
    'checked_in_at', v_record.checked_in_at,
    'is_late', v_record.status = 'late'
  );
end
$$;

create or replace function public.record_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.current_profile_id();
  v_session uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select id into v_session
    from public.checkin_sessions
   where token = p_token
   limit 1;

  -- An unknown token still burns a rate-limit attempt; the bucket is the
  -- event's when we can resolve it and the "unknown code" bucket when we can't.
  if v_session is null then
    return public.record_checkin_for_session(null, v_uid);
  end if;

  return public.record_checkin_for_session(v_session, v_uid);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
end
$$;

create or replace function public.record_attendance_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.current_profile_id();
  v_session uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'You are not signed in.');
  end if;

  select id into v_session
    from public.checkin_sessions
   where entry_code = upper(trim(p_code))
   limit 1;

  if v_session is null then
    return public.record_checkin_for_session(null, v_uid);
  end if;

  return public.record_checkin_for_session(v_session, v_uid);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not record attendance — are you on the roster?');
end
$$;

-- Legacy boolean signature — delegates to the status-based one.
create or replace function public.override_attendance(p_event_id uuid, p_student_id uuid, p_attended boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_attended then
    return public.override_attendance(p_event_id, p_student_id, 'present', '', '');
  else
    return public.override_attendance(p_event_id, p_student_id, 'absent', '', '');
  end if;
end
$$;

create or replace function public.override_attendance(
  p_event_id uuid,
  p_student_id uuid,
  p_status text DEFAULT 'present',
  p_excuse_reason text DEFAULT '',
  p_staff_note text DEFAULT ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := public.current_profile_id();
  v_ensemble     uuid;
  v_record_id    uuid;
  v_section      uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  select ensemble_id into v_ensemble from public.events where id = p_event_id;
  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'Unknown event.');
  end if;

  -- Staff of the event's program — or a section leader *of that section*.
  if not (
    public.is_ensemble_staff(v_ensemble)
    or public.has_role_in(v_ensemble, 'section_leader')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Only staff may override attendance.');
  end if;

  -- Section scoping applies only to section leaders — not to directors or
  -- secretaries, who may mark anyone (with or without the extra role).
  if public.has_role_in(v_ensemble, 'section_leader')
     and not public.has_role_in(v_ensemble, 'director')
     and not public.has_role_in(v_ensemble, 'secretary') then
    select m.section_id into v_section
      from public.memberships m
     where m.user_id = p_student_id
       and m.ensemble_id = v_ensemble;

    if not public.is_section_leader_for(v_uid, v_section) then
      return jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    end if;
  end if;

  if not exists (
    select 1 from public.memberships
     where user_id = p_student_id and ensemble_id = v_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;

  -- Directors don't have attendance records.
  if exists (
    select 1 from public.memberships
     where user_id = p_student_id
       and ensemble_id = v_ensemble
       and roles @> '{director}'::public.app_role[]
  ) then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t have attendance records.');
  end if;

  if p_status not in ('present', 'absent', 'excused', 'late') then
    return jsonb_build_object('ok', false, 'message', 'Invalid attendance status.');
  end if;

  if p_status = 'absent' then
    delete from public.attendance_records
     where event_id = p_event_id and student_id = p_student_id;
  else
    insert into public.attendance_records (
      event_id, student_id, attended, checked_in_at, status,
      excuse_reason, is_late, marked_by
    )
    values (
      p_event_id, p_student_id,
      p_status in ('present', 'late'),
      case when p_status in ('present', 'late') then now() else null end,
      p_status,
      p_excuse_reason,
      p_status = 'late',
      v_uid
    )
    on conflict (event_id, student_id)
    do update set
      attended = excluded.attended,
      checked_in_at = case
        when excluded.status in ('present', 'late') and attendance_records.checked_in_at is null
        then now()
        else attendance_records.checked_in_at
      end,
      status = excluded.status,
      excuse_reason = excluded.excuse_reason,
      is_late = excluded.is_late,
      marked_by = excluded.marked_by
    returning id into v_record_id;

    if coalesce(p_staff_note, '') = '' then
      delete from public.attendance_staff_notes
       where attendance_record_id = v_record_id;
    else
      insert into public.attendance_staff_notes (
        attendance_record_id, staff_note, created_by, updated_at
      )
      values (v_record_id, p_staff_note, v_uid, now())
      on conflict (attendance_record_id)
      do update set
        staff_note = excluded.staff_note,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at;
    end if;
  end if;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Override failed.');
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Analytics — director of that program (or a program admin) only.
-- ---------------------------------------------------------------------------

-- ONE percentage formula. Numerator and denominator are built from the SAME
-- event set (required, not archived, already happened, not excused for that
-- student), so the number can never exceed 100 or drift between screens.
-- `late` counts as attended because the check-in RPCs store attended = true
-- for late rows.
create or replace function public.attendance_pct_for(p_ensemble uuid, p_student_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with required_events as (
    select e.id
      from public.events e
     where e.ensemble_id = p_ensemble
       and e.archived = false
       and e.attendance_requirement = 'required'
       and e.date < now()
       and not exists (
         select 1 from public.attendance_records ar2
          where ar2.event_id = e.id
            and ar2.student_id = p_student_id
            and ar2.status = 'excused'
       )
  )
  select coalesce(
    round(
      (select count(*)::numeric
         from public.attendance_records ar
         join required_events re on re.id = ar.event_id
        where ar.student_id = p_student_id
          and ar.attended = true)
      / nullif((select count(*)::numeric from required_events), 0) * 100,
      0
    ),
    0
  )
$$;

create or replace function public.get_student_attendance_pct(p_student_id uuid, p_ensemble uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_student_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on this roster.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'percentage', public.attendance_pct_for(p_ensemble, p_student_id)
  );
end
$$;

create or replace function public.get_section_attendance_stats(p_ensemble uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.can_manage_ensemble(p_ensemble) then
      jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
    else (
      with roster as (
        select m.user_id,
               coalesce(s.name, '') as section,
               s.sort_order
          from public.memberships m
          left join public.sections s on s.id = m.section_id
         where m.ensemble_id = p_ensemble
           and m.active
           and not ('director' = any(m.roles))
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'section', x.section,
            'member_count', x.member_count,
            'avg_attendance_pct', x.avg_attendance_pct,
            -- additive: lets the UI order section chips canonically
            'sort_order', x.sort_order
          )
          order by x.sort_order, x.section
        ),
        '[]'::jsonb
      )
        from (
          select section,
                 sort_order,
                 count(distinct user_id) as member_count,
                 round(avg(public.attendance_pct_for(p_ensemble, user_id)), 1) as avg_attendance_pct
            from roster
           where section <> ''
           group by section, sort_order
        ) x
    )
  end
$$;

create or replace function public.get_event_attendance_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when not public.can_manage_ensemble(e.ensemble_id) then
          jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
        else jsonb_build_object(
          'ok', true,
          'present', (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'present'),
          'late',    (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'late'),
          'excused', (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'excused'),
          'absent',  (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and (ar.status = 'absent' or ar.status is null)),
          'total',   (select count(*) from public.memberships m
                       where m.ensemble_id = e.ensemble_id
                         and m.active
                         and not ('director' = any(m.roles)))
        )
      end
        from public.events e
       where e.id = p_event_id
    ),
    jsonb_build_object('ok', false, 'message', 'Unknown event.')
  )
$$;

create or replace function public.get_attendance_trend(p_ensemble uuid, p_limit integer DEFAULT 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.can_manage_ensemble(p_ensemble) then
      jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
    else (
      with recent_events as (
        select e.id, e.name, e.type, e.date, e.event_type
          from public.events e
         where e.ensemble_id = p_ensemble
           and e.archived = false
           and e.attendance_requirement = 'required'
           and e.date < now()
         order by e.date desc
         limit greatest(coalesce(p_limit, 0), 0)
      ),
      event_stats as (
        select
          re.id, re.name, re.type, re.date, re.event_type,
          (select count(*) from public.memberships m
            where m.ensemble_id = p_ensemble
              and m.active
              and not ('director' = any(m.roles))) as roster_size,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.attended = true) as present_count,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.status = 'excused') as excused_count,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.status = 'late') as late_count
        from recent_events re
      )
      select coalesce(jsonb_agg(row_to_json(es)), '[]'::jsonb) from event_stats es
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- 5. Notification fan-out — the event's program only (not the whole database).
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.suppress_event_notifications', true) = 'true' then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, payload)
  select m.user_id, 'new_event', 'New event added', new.name,
         jsonb_build_object('event_id', new.id, 'event_name', new.name)
    from public.memberships m
   where m.ensemble_id = new.ensemble_id
     and m.active
     and m.user_id is distinct from new.created_by;
  return new;
end
$$;

create or replace function public.notify_checkin_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text;
  v_ensemble uuid;
begin
  select name, ensemble_id into v_name, v_ensemble
    from public.events where id = new.event_id;

  insert into public.notifications (user_id, type, title, body, payload)
  select m.user_id, 'checkin_open', 'Check-in is open', coalesce(v_name, 'Check-in is live'),
         jsonb_build_object('event_id', new.event_id, 'event_name', v_name)
    from public.memberships m
   where m.ensemble_id = v_ensemble
     and m.active
     and m.user_id is distinct from new.created_by;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — the client-facing surface. Helpers stay restricted (013/015);
--    `register_signup` is service-role only (it is the webhook's entry point).
-- ---------------------------------------------------------------------------
-- Functions are EXECUTE-able by PUBLIC by default and Supabase's default
-- privileges also hand every new function to `anon` — so the whole public
-- schema is revoked from both here, once, and the explicit grants below (plus
-- the 013/015 ones) re-open exactly what signed-in clients need.
-- This closes the "SECURITY DEFINER function executable by anon" advisor
-- finding for every function, including the ones 018 has not retired yet.
do $$
declare
  r record;
begin
  for r in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end
$$;

revoke all on function public.get_join_code(uuid)                    from public, anon;
revoke all on function public.set_join_code(uuid, text)              from public, anon;
revoke all on function public.get_join_code_status(text)             from public, anon;
revoke all on function public.validate_join_code(text, text, text)   from public, anon, authenticated;
revoke all on function public.register_signup(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.deactivate_member(uuid, uuid)          from public, anon;
revoke all on function public.reactivate_member(uuid, uuid)          from public, anon;
revoke all on function public.set_member_section(uuid, uuid, uuid)   from public, anon;
revoke all on function public.start_checkin_session(uuid)            from public, anon;
revoke all on function public.record_attendance(text)                from public, anon;
revoke all on function public.record_attendance_by_code(text)        from public, anon;
revoke all on function public.record_checkin_for_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.override_attendance(uuid, uuid, boolean)         from public, anon;
revoke all on function public.override_attendance(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.attendance_pct_for(uuid, uuid)          from public, anon;
revoke all on function public.get_student_attendance_pct(uuid, uuid)  from public, anon;
revoke all on function public.get_section_attendance_stats(uuid)      from public, anon;
revoke all on function public.get_event_attendance_summary(uuid)      from public, anon;
revoke all on function public.get_attendance_trend(uuid, integer)     from public, anon;

grant execute on function public.get_join_code(uuid)                    to authenticated, service_role;
grant execute on function public.set_join_code(uuid, text)              to authenticated, service_role;
grant execute on function public.get_join_code_status(text)             to authenticated, service_role;
grant execute on function public.validate_join_code(text, text, text)   to service_role;
grant execute on function public.register_signup(text, text, text, text, text, text) to service_role;
grant execute on function public.deactivate_member(uuid, uuid)          to authenticated, service_role;
grant execute on function public.reactivate_member(uuid, uuid)          to authenticated, service_role;
grant execute on function public.set_member_section(uuid, uuid, uuid)   to authenticated, service_role;
grant execute on function public.start_checkin_session(uuid)            to authenticated, service_role;
grant execute on function public.record_attendance(text)                to authenticated, service_role;
grant execute on function public.record_attendance_by_code(text)        to authenticated, service_role;
grant execute on function public.record_checkin_for_session(uuid, uuid) to service_role;
grant execute on function public.override_attendance(uuid, uuid, boolean)         to authenticated, service_role;
grant execute on function public.override_attendance(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.attendance_pct_for(uuid, uuid)          to service_role;
grant execute on function public.get_student_attendance_pct(uuid, uuid)  to authenticated, service_role;
grant execute on function public.get_section_attendance_stats(uuid)      to authenticated, service_role;
grant execute on function public.get_event_attendance_summary(uuid)      to authenticated, service_role;
grant execute on function public.get_attendance_trend(uuid, integer)     to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_left text;
begin
  -- The retired RPC names must be gone.
  select string_agg(p.proname, ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'invite_member', 'invite_member_one', 'invite_members_bulk',
       'reset_member_password', 'get_roster_emails', 'update_member_instrument',
       'get_band_join_code', 'set_band_join_code', 'get_band_join_code_status',
       'validate_band_join_code'
     );
  if v_left is not null then
    raise exception 'FAIL: retired RPCs still exist: %', v_left;
  end if;

  -- anon must not be able to execute anything in public.
  select string_agg(p.proname, ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_left is not null then
    raise exception 'FAIL: anon can still execute: %', v_left;
  end if;

  raise notice 'RPCs OK: ensemble-scoped surface in place, anon locked out of every public function';
end
$$;

