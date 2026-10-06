-- ============================================================================
-- RHS Music Platform — Migration 014
-- Backfill the band ensemble (runs once; idempotent)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- ORDERING NOTE (deliberate deviation from PLATFORM_PLAN §3's file numbering):
-- the plan listed this as 016, after 015 "retire profiles.instrument/roles" —
-- but this file is what *copies* those columns, and §3's own text says
-- "nullable → backfill → NOT NULL". Backfill therefore has to run before the
-- rewrite that reads it (015) and before the retirement (016), so lexical
-- filename order == apply order == dependency order.
--
-- What this does:
--   1. Insert ensemble 'band' (the only program shipping now).
--   2. Create sections from the distinct `profiles.instrument` values, in the
--      canonical order (Flute → Percussion); unknown values get a section too,
--      deterministically; empty instrument → NULL section ("no section = no
--      access", same rule as today).
--   3. Create one membership per profile: roles copied verbatim, section
--      resolved from the instrument, active = not deactivated.
--   4. Point every event (manual + Google-synced) at band.
--   5. Move `app_settings['band_join_code']` → `ensemble_settings.join_code`.
--   6. Insert the known RHS Band ICS feed as a calendar source.
--   7. Verify zero orphans, then set `events.ensemble_id NOT NULL`.
--
-- All user ids, roles and attendance history are preserved — nothing is copied
-- or regenerated here, rows are only *linked*.
-- ============================================================================

do $$
declare
  v_band uuid;
  v_ics  text := 'https://calendar.google.com/calendar/ical/9f3763f58e6882a95ca8064b93de88d329622698cfcaa9e2450b58c594b2c48e%40group.calendar.google.com/public/basic.ics';
begin
  ---------------------------------------------------------------------------
  -- 1. The band ensemble
  ---------------------------------------------------------------------------
  insert into public.ensembles (slug, name, short_name, theme_color)
  values ('band', 'RHS Band', 'RHS Band', '#2d5a1b')
  on conflict (slug) do nothing;

  select id into v_band from public.ensembles where slug = 'band';
  if v_band is null then
    raise exception 'FAIL: could not resolve the band ensemble';
  end if;

  -- The three blocks below read the LEGACY profiles columns (instrument,
  -- roles, deactivated). `instrument` and `roles` are dropped by
  -- 018_retire_legacy.sql, so each block is skipped when its source column is
  -- already gone — that keeps the whole pipeline re-runnable against a database
  -- that has already been migrated, without weakening the first run.
  -- (plpgsql only parses a statement when it reaches it, so an unexecuted
  -- branch may safely mention a dropped column.)

  ---------------------------------------------------------------------------
  -- 2. Sections from the old instrument strings
  ---------------------------------------------------------------------------
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'instrument'
  ) then
    with canon(name, ord) as (
      values ('Flute',1), ('Clarinet',2), ('Saxophone',3), ('Trumpet',4),
             ('Trombone',5), ('Baritone',6), ('Percussion',7)
    ),
    vals as (
      select distinct trim(p.instrument) as name
        from public.profiles p
       where coalesce(trim(p.instrument), '') <> ''
    )
    insert into public.sections (ensemble_id, name, sort_order)
    select v_band,
           vals.name,
           coalesce(c.ord, 100 + row_number() over (order by vals.name))
      from vals
      left join canon c on c.name = vals.name
    on conflict (ensemble_id, name) do nothing;

    -------------------------------------------------------------------------
    -- 3. Memberships from profiles (roles + section + active flag)
    -------------------------------------------------------------------------
    insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
    select p.id,
           v_band,
           s.id,
           coalesce(p.roles, '{student}'::public.app_role[]),
           not coalesce(p.deactivated, false)
      from public.profiles p
      left join public.sections s
        on s.ensemble_id = v_band
       and s.name = trim(coalesce(p.instrument, ''))
    on conflict (user_id, ensemble_id) do nothing;
  else
    -- Already migrated: make sure every profile still has its band membership
    -- (a re-run must never leave someone unreachable).
    insert into public.memberships (user_id, ensemble_id, roles, active)
    select p.id, v_band, '{student}'::public.app_role[], not coalesce(p.deactivated, false)
      from public.profiles p
      left join public.memberships m
        on m.user_id = p.id and m.ensemble_id = v_band
     where m.id is null
       and not exists (select 1 from public.program_admins pa where pa.user_id = p.id)
    on conflict (user_id, ensemble_id) do nothing;
  end if;

  ---------------------------------------------------------------------------
  -- 4. Every event belongs to band
  ---------------------------------------------------------------------------
  update public.events
     set ensemble_id = v_band
   where ensemble_id is null;

  ---------------------------------------------------------------------------
  -- 5. Join code: app_settings['band_join_code'] → ensemble_settings.
  --    Dynamic SQL because app_settings is retired in 016 — a static reference
  --    would fail to parse once it is gone.
  ---------------------------------------------------------------------------
  if to_regclass('public.app_settings') is not null then
    execute format(
      'insert into public.ensemble_settings (ensemble_id, join_code)
       select %L::uuid, coalesce((select value from public.app_settings where key = %L), %L)
       on conflict (ensemble_id) do nothing',
      v_band, 'band_join_code', '');
  else
    insert into public.ensemble_settings (ensemble_id, join_code)
    values (v_band, '')
    on conflict (ensemble_id) do nothing;
  end if;

  ---------------------------------------------------------------------------
  -- 6. Known RHS Band calendar feed
  ---------------------------------------------------------------------------
  insert into public.calendar_sources (ensemble_id, provider, ics_url, name)
  select v_band, 'google_ics', v_ics, 'RHS Band Google Calendar'
   where not exists (
     select 1 from public.calendar_sources cs
      where cs.ensemble_id = v_band
        and cs.ics_url     = v_ics
   );
end $$;

-- ---------------------------------------------------------------------------
-- 7. Verification — raise on any orphan, print the counts, then NOT NULL
-- ---------------------------------------------------------------------------
do $$
declare
  v_band uuid;
  v_events int; v_events_orphan int; v_profiles int; v_profiles_orphan int;
  v_attendance int; v_attendance_orphan int; v_memberships int; v_sections int;
  v_join_code text;
begin
  select id into v_band from public.ensembles where slug = 'band';
  if v_band is null then
    raise exception 'FAIL: band ensemble missing after backfill';
  end if;

  select count(*) into v_events      from public.events;
  select count(*) into v_events_orphan from public.events where ensemble_id is null;
  if v_events_orphan > 0 then
    raise exception 'FAIL: % of % events have no ensemble', v_events_orphan, v_events;
  end if;

  select count(*) into v_attendance
    from public.attendance_records ar
    join public.events e on e.id = ar.event_id;
  select count(*) into v_attendance_orphan
    from public.attendance_records ar
    left join public.events e on e.id = ar.event_id
   where e.id is null or e.ensemble_id is null;
  if v_attendance_orphan > 0 then
    raise exception 'FAIL: % of % attendance rows do not resolve to an ensemble',
      v_attendance_orphan, v_attendance;
  end if;

  -- Every person is reachable: an active-or-inactive membership, or a program admin.
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_profiles_orphan
    from public.profiles p
   where not exists (select 1 from public.memberships m where m.user_id = p.id)
     and not exists (select 1 from public.program_admins pa where pa.user_id = p.id);
  if v_profiles_orphan > 0 then
    raise exception 'FAIL: % of % profiles have no membership and are not program admins',
      v_profiles_orphan, v_profiles;
  end if;

  select count(*) into v_memberships from public.memberships where ensemble_id = v_band;
  select count(*) into v_sections    from public.sections    where ensemble_id = v_band;
  select join_code into v_join_code  from public.ensemble_settings where ensemble_id = v_band;

  -- Join code preserved (only meaningful while the legacy table still exists).
  if to_regclass('public.app_settings') is not null then
    if coalesce(v_join_code, '') is distinct from
       coalesce((select value from public.app_settings where key = 'band_join_code'), '') then
      raise exception 'FAIL: band join code was not preserved (ensemble_settings=%, app_settings=%)',
        coalesce(v_join_code, '<null>'),
        coalesce((select value from public.app_settings where key = 'band_join_code'), '<null>');
    end if;
  end if;

  raise notice 'band backfill OK: events=%, memberships=%, sections=%, join_code set=%',
    v_events, v_memberships, v_sections, coalesce(v_join_code, '') <> '';
end $$;

-- Zero orphans confirmed above — safe to enforce.
do $$
begin
  if exists (select 1 from public.events where ensemble_id is null) then
    raise exception 'FAIL: refusing to set events.ensemble_id NOT NULL with null rows present';
  end if;
  execute 'alter table public.events alter column ensemble_id set not null';
end $$;
