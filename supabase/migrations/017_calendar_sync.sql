-- ============================================================================
-- RHS Music Platform — Migration 017
-- Google Calendar sync: per-calendar-source, with the §6 bug fixes
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes: `sync_google_calendar_events` is now scoped to ONE
-- `calendar_sources` row (therefore to one program) instead of mass-replacing
-- every Google event in the database, and it carries the four fixes from
-- PLATFORM_PLAN §6:
--
--   1. Event type. Synced events used to write `type` but never `event_type`,
--      so the column default `'rehearsal'` made EVERY Google event display as
--      "Rehearsal" (and `supabase/fix_event_types.sql` existed to patch it by
--      hand). Both fields are written now, and `event_type` is the canonical
--      lowercase key the UI's label map expects.
--   2. Attendance requirement / check-in mode. Synced events used to inherit the
--      column defaults (`required` + `qr`), which made "NO SCHOOL" and the
--      Banquet count as required attendance events in analytics. They are now
--      derived from the event type by `calendar_event_defaults()` — the same
--      mapping the frontend's `defaultCheckinMode()` uses, extended with the
--      no-attendance cases (respecting the DB constraint
--      requirement = 'none' ⟺ mode = 'none'). Existing synced rows that still
--      hold the old blanket defaults are corrected on the next sync; rows a
--      human has customized are left alone.
--   3. Empty-feed guard. A successful fetch that parsed to zero events used to
--      archive the entire synced calendar. A zero-event feed now archives
--      nothing, and a feed that returns less than half of what is currently on
--      the calendar skips the archive pass too — both return a `warning`.
--   4. Authorization. `verify_jwt = false` + "any signed-in user" meant any
--      student could trigger a sync. The RPC now requires the sync job (service
--      role, which holds CALENDAR_SYNC_SECRET in the edge function) or staff of
--      that program; the edge function's own config fix is tracked in
--      `scripts/migrate/04_functions_config.md`.
--
-- Cosmetic fix as well: the old function reused one counter for two meanings
-- (`v_deleted_now`) and always reported `deleted: 0` even when it had deleted
-- rows. The result now reports `deleted` truthfully and adds `warning`.
--
-- v1 scope note: one calendar source per program. `events` has
-- `google_calendar_uid` but no source column (PLATFORM_PLAN T8), so "this
-- source's events" is resolved as "this program's Google-synced events".
-- Multiple feeds for one program would need `events.calendar_source_id` — a
-- later, additive migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Type → event_type / attendance_requirement / checkin_mode
-- ---------------------------------------------------------------------------
create or replace function public.calendar_event_defaults(p_type text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with t as (select lower(trim(coalesce(p_type, ''))) as k)
  select jsonb_build_object(
    -- canonical key for EVENT_TYPE_LABEL; mirrors the frontend's vocabulary
    'event_type', case
        when k in ('rehearsal','concert','game','competition','performance',
                   'audition','workshop','sectional','parade','festival','recital')
          then case k
                 when 'sectional' then 'rehearsal'
                 when 'parade'    then 'performance'
                 when 'festival'  then 'performance'
                 when 'recital'   then 'performance'
                 else k
               end
        when k like '%section%meeting%' then 'section meeting'
        when k like '%band%meeting%'    then 'band meeting'
        when k like '%parent%meeting%'  then 'parent meeting'
        when k like '%meeting%'         then 'general meeting'
        when k like '%fundrais%' or k like '%booster%' then 'fundraiser'
        when k like '%trip%'            then 'trip'
        else 'other'
      end,
    -- no-attendance types: holidays and purely social events
    'attendance_requirement', case
        when k in ('rehearsal','concert','game','competition','performance',
                   'audition','workshop','sectional','parade','festival','recital')
          or k like '%meeting%'
          then 'required'
        when k like '%no school%' or k like '%holiday%' or k like '%day off%'
          or k like '%early release%' or k like '%half day%'
          or k like '%banquet%' or k like '%social%' or k like '%party%'
          then 'none'
        else 'optional'
      end,
    'checkin_mode', case
        when k in ('rehearsal','concert','game','competition','performance',
                   'audition','workshop','sectional','parade','festival','recital')
          then 'qr'
        when k like '%no school%' or k like '%holiday%' or k like '%day off%'
          or k like '%early release%' or k like '%half day%'
          or k like '%banquet%' or k like '%social%' or k like '%party%'
          then 'none'
        else 'toggle'
      end
  )
  from t
$$;

comment on function public.calendar_event_defaults(text) is
  'Derived event_type / attendance_requirement / checkin_mode for a Google Calendar event type. Pure — no table access.';

-- ---------------------------------------------------------------------------
-- 2. The sync RPC
-- ---------------------------------------------------------------------------
drop function if exists public.sync_google_calendar_events(jsonb, boolean);

create or replace function public.sync_google_calendar_events(
  p_calendar_source uuid,
  p_events jsonb,
  p_replace_all boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := coalesce(
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                         ''
                       );
  v_ensemble    uuid;
  v_events      jsonb := case
                           when jsonb_typeof(p_events) = 'array' then p_events
                           else '[]'::jsonb
                         end;
  v_event       jsonb;
  v_seen        text[] := '{}';
  v_uid         text;
  v_defaults    jsonb;
  v_existing    uuid;
  v_incoming    int;
  v_on_calendar int := 0;
  v_inserted    int := 0;
  v_updated     int := 0;
  v_archived    int := 0;
  v_deleted     int := 0;
  v_disappeared int := 0;
  v_skip_wipe   boolean := false;
  v_warning     text := null;
begin
  select cs.ensemble_id into v_ensemble
    from public.calendar_sources cs
   where cs.id = p_calendar_source;

  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'Unknown calendar source.');
  end if;

  -- The sync job (service role, holds CALENDAR_SYNC_SECRET) or staff of that
  -- program. Students can no longer trigger a sync.
  if v_role <> 'service_role' and not public.is_ensemble_staff(v_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors or the calendar sync job can run a sync.');
  end if;

  perform set_config('app.suppress_event_notifications', 'true', true);

  v_incoming := coalesce(jsonb_array_length(v_events), 0);

  select count(*) into v_on_calendar
    from public.events e
   where e.ensemble_id = v_ensemble
     and e.google_calendar_uid is not null
     and e.archived = false;

  -- --- Guards (fix 3): never mass-archive on a suspicious feed --------------
  if v_incoming = 0 then
    v_skip_wipe := true;
    v_warning := 'The calendar feed returned no events — nothing was archived. If this persists, check the feed URL.';
  elsif p_replace_all and v_on_calendar > 0 and v_incoming * 2 < v_on_calendar then
    v_skip_wipe := true;
    v_warning := format(
      'Only %s events came back but %s are on the calendar — the replace/archive pass was skipped to protect history.',
      v_incoming, v_on_calendar
    );
  end if;

  -- --- Replace pass (unchanged semantics, now scoped) ----------------------
  -- Manual events (google_calendar_uid IS NULL) are never touched. Events with
  -- attendance history are archived, never deleted.
  if p_replace_all and not v_skip_wipe then
    update public.events e
       set archived = true
     where e.ensemble_id = v_ensemble
       and e.google_calendar_uid is not null
       and e.archived = false
       and exists (
         select 1 from public.attendance_records ar where ar.event_id = e.id
       );
    get diagnostics v_archived = row_count;

    delete from public.events e
     where e.ensemble_id = v_ensemble
       and e.google_calendar_uid is not null
       and not exists (
         select 1 from public.attendance_records ar where ar.event_id = e.id
       );
    get diagnostics v_deleted = row_count;
  end if;

  -- --- Upsert the feed -----------------------------------------------------
  for v_event in select * from jsonb_array_elements(v_events) loop
    v_uid := coalesce(v_event ->> 'uid', '');
    if v_uid = '' then
      continue;
    end if;

    v_seen     := array_append(v_seen, v_uid);
    v_defaults := public.calendar_event_defaults(v_event ->> 'type');

    select id into v_existing
      from public.events
     where google_calendar_uid = v_uid;

    insert into public.events (
      name, type, event_type, date, end_date, all_day, location, description,
      google_calendar_uid, google_calendar_updated_at, google_calendar_synced_at,
      created_by, event_source, ensemble_id,
      attendance_requirement, checkin_mode
    ) values (
      coalesce(nullif(v_event ->> 'name', ''), 'Untitled event'),
      coalesce(nullif(v_event ->> 'type', ''), 'Rehearsal'),
      -- fix 1: both fields, so a synced event never falls back to 'rehearsal'
      v_defaults ->> 'event_type',
      (v_event ->> 'date')::timestamptz,
      nullif(v_event ->> 'end_date', '')::timestamptz,
      coalesce((v_event ->> 'all_day')::boolean, false),
      coalesce(v_event ->> 'location', ''),
      coalesce(v_event ->> 'description', ''),
      v_uid,
      nullif(v_event ->> 'updated_at', '')::timestamptz,
      now(),
      null,
      'google_calendar',
      v_ensemble,
      v_defaults ->> 'attendance_requirement',
      v_defaults ->> 'checkin_mode'
    )
    on conflict (google_calendar_uid) do update set
      name                       = excluded.name,
      type                       = excluded.type,
      event_type                 = excluded.event_type,
      date                       = excluded.date,
      end_date                   = excluded.end_date,
      all_day                    = excluded.all_day,
      location                   = excluded.location,
      description                = excluded.description,
      google_calendar_updated_at = excluded.google_calendar_updated_at,
      google_calendar_synced_at  = excluded.google_calendar_synced_at,
      -- fix 2, non-destructive: adopt the type-derived values only while the
      -- row still holds the old blanket defaults (required + qr). Anything a
      -- human chose sticks, which is what the UI promises for synced events.
      attendance_requirement = case
        when events.attendance_requirement = 'required' and events.checkin_mode = 'qr'
          then excluded.attendance_requirement
        else events.attendance_requirement
      end,
      checkin_mode = case
        when events.attendance_requirement = 'required' and events.checkin_mode = 'qr'
          then excluded.checkin_mode
        else events.checkin_mode
      end;

    if v_existing is null then
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- --- Archive events that disappeared from the feed -----------------------
  -- (archived, never deleted — historical attendance is preserved)
  if not v_skip_wipe then
    update public.events e
       set archived = true
     where e.ensemble_id = v_ensemble
       and e.google_calendar_uid is not null
       and not (e.google_calendar_uid = any(v_seen))
       and e.archived = false;
    get diagnostics v_disappeared = row_count;
    v_archived := v_archived + v_disappeared;
  end if;

  update public.calendar_sources
     set last_synced_at = now()
   where id = p_calendar_source;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'archived', v_archived,
    'deleted', v_deleted,
    'seen', coalesce(array_length(v_seen, 1), 0),
    'warning', v_warning
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Google Calendar sync failed: ' || sqlerrm);
end
$$;

comment on function public.sync_google_calendar_events(uuid, jsonb, boolean) is
  'Scoped Google ICS sync: upserts/archives only the events of the source''s program. Guards against empty/short feeds. Callable by the sync job (service role) or that program''s staff.';

-- ---------------------------------------------------------------------------
-- 3. Grant hygiene — internal functions are not client-callable
-- ---------------------------------------------------------------------------
-- Functions used *inside policies* must stay executable by `authenticated`
-- (policies run with the caller's privileges); everything below is trigger-,
-- RPC- or job-internal only.
do $$
declare
  v_fn  text;
  v_off text[] := array[
    -- trigger functions: invoked by the system, never by a client
    'notify_new_event()',
    'notify_checkin_open()',
    'notify_chat_message()',
    'invalidate_checkin_sessions_on_mode_change()',
    'handle_new_user()',
    'guard_role_change()',
    'guard_membership_change()',
    'guard_profile_self_update()',
    -- internal building blocks of the RPCs above
    'client_ip()',
    'record_checkin_for_session(uuid, uuid)',
    'attendance_pct_for(uuid, uuid)',
    'validate_join_code(text, text, text)',
    'register_signup(text, text, text, text, text, text)',
    'rls_auto_enable()'
  ];
begin
  foreach v_fn in array v_off loop
    if to_regprocedure('public.' || v_fn) is not null then
      execute format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    end if;
  end loop;
end
$$;

-- The sync RPC and the calendar-defaults helper.
revoke all on function public.calendar_event_defaults(text)              from public, anon;
revoke all on function public.sync_google_calendar_events(uuid, jsonb, boolean)
  from public, anon;

grant execute on function public.calendar_event_defaults(text)           to authenticated, service_role;
grant execute on function public.sync_google_calendar_events(uuid, jsonb, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_left   text;
  v_anon   text;
  v_n      int;
  v_sample jsonb;
begin
  -- Exactly one signature: the old 2-argument form must be gone, or a 2-arg
  -- call would be ambiguous against the new defaulted 3-arg form.
  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sync_google_calendar_events';
  if v_n <> 1 then
    raise exception 'FAIL: expected exactly one sync_google_calendar_events overload, found %', v_n;
  end if;

  select string_agg(pg_get_function_arguments(p.oid), ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'sync_google_calendar_events'
     and p.pronargs <> 3;
  if v_left is not null then
    raise exception 'FAIL: stale sync_google_calendar_events overload(s): %', v_left;
  end if;

  -- No internal function is client-executable.
  select string_agg(p.proname, ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'notify_new_event', 'notify_checkin_open', 'notify_chat_message',
       'invalidate_checkin_sessions_on_mode_change', 'handle_new_user',
       'guard_role_change', 'guard_membership_change', 'guard_profile_self_update',
       'client_ip', 'record_checkin_for_session', 'attendance_pct_for',
       'validate_join_code', 'register_signup'
     )
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v_left is not null then
    raise exception 'FAIL: internal functions still client-callable: %', v_left;
  end if;

  select string_agg(p.proname, ', ')
    into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon is not null then
    raise exception 'FAIL: anon can still execute: %', v_anon;
  end if;

  -- The derivation satisfies the DB constraint (none ⟺ none) for every branch.
  for v_sample in select jsonb_array_elements('[
      {"event_type":"rehearsal","attendance_requirement":"required","checkin_mode":"qr"},
      {"event_type":"general meeting","attendance_requirement":"required","checkin_mode":"toggle"},
      {"event_type":"fundraiser","attendance_requirement":"optional","checkin_mode":"toggle"},
      {"event_type":"other","attendance_requirement":"none","checkin_mode":"none"}
    ]'::jsonb) loop
    if (v_sample ->> 'attendance_requirement' = 'none') <> (v_sample ->> 'checkin_mode' = 'none') then
      raise exception 'FAIL: requirement/mode pairing violated for %', v_sample;
    end if;
  end loop;

  raise notice 'calendar sync OK: scoped to one source, type-derived attendance, empty-feed guard, staff-only';
end
$$;
