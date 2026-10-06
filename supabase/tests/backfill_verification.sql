-- ============================================================================
-- backfill_verification.sql — Phase 2 gate for the band backfill (014)
-- ============================================================================
-- Asserts that the legacy single-program data was linked to the band ensemble
-- without loss: nothing orphaned, roles/sections/active preserved, join code
-- moved, every program entity scoped.
--
-- Runs inside BEGIN … ROLLBACK (read-only suite; the rollback is defensive, the
-- pattern every suite in this directory follows). Self-checking: raises
-- 'FAIL: <id> …' on the first violation. Run via psql -f, or
-- `06_apply_migrations.sh --dry-run --with-tests` for a full rehearsal.
--
-- Legacy columns/tables that 016 retires are checked only when still present,
-- so this suite keeps working after the retirement.
--
-- requires-table: public.ensembles
-- ============================================================================

begin;

do $$
declare
  v_band uuid;
  v_events_total int; v_events_band int;
  v_attendance_total int; v_attendance_orphan int;
  v_profiles_total int; v_profiles_orphan int;
  v_memberships int; v_sections int;
  v_roles_mismatch int; v_active_mismatch int; v_section_mismatch int;
  v_join_code text;
begin
  ---------------------------------------------------------------------------
  -- 1. Exactly one ensemble: band, active
  ---------------------------------------------------------------------------
  select id into v_band from public.ensembles where slug = 'band';
  if v_band is null then
    raise exception 'FAIL: B1 no ensemble with slug = band';
  end if;

  if (select count(*) from public.ensembles) <> 1 then
    raise exception 'FAIL: B2 expected exactly 1 ensemble, found %',
      (select count(*) from public.ensembles);
  end if;

  if not (select active from public.ensembles where id = v_band) then
    raise exception 'FAIL: B3 band ensemble is not active';
  end if;

  ---------------------------------------------------------------------------
  -- 2. Every event is scoped to band (and the column is NOT NULL)
  ---------------------------------------------------------------------------
  select count(*) into v_events_total from public.events;
  select count(*) into v_events_band  from public.events where ensemble_id = v_band;
  if v_events_total <> v_events_band then
    raise exception 'FAIL: B4 % of % events are not linked to band',
      v_events_total - v_events_band, v_events_total;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'events'
       and column_name = 'ensemble_id' and is_nullable = 'YES'
  ) then
    raise exception 'FAIL: B5 events.ensemble_id is still nullable';
  end if;

  ---------------------------------------------------------------------------
  -- 3. Every attendance row resolves to a scoped event
  ---------------------------------------------------------------------------
  select count(*) into v_attendance_total  from public.attendance_records;
  select count(*) into v_attendance_orphan
    from public.attendance_records ar
    left join public.events e on e.id = ar.event_id
   where e.id is null or e.ensemble_id is null;
  if v_attendance_orphan > 0 then
    raise exception 'FAIL: B6 % of % attendance rows do not resolve to an ensemble',
      v_attendance_orphan, v_attendance_total;
  end if;

  ---------------------------------------------------------------------------
  -- 4. Every person is reachable (membership or program admin)
  ---------------------------------------------------------------------------
  select count(*) into v_profiles_total from public.profiles;
  select count(*) into v_profiles_orphan
    from public.profiles p
   where not exists (select 1 from public.memberships m where m.user_id = p.id)
     and not exists (select 1 from public.program_admins pa where pa.user_id = p.id);
  if v_profiles_orphan > 0 then
    raise exception 'FAIL: B7 % of % profiles are unreachable (no membership, not a program admin)',
      v_profiles_orphan, v_profiles_total;
  end if;

  ---------------------------------------------------------------------------
  -- 5. Membership count matches profile count for band (one per person)
  ---------------------------------------------------------------------------
  select count(*) into v_memberships from public.memberships where ensemble_id = v_band;
  if v_memberships <> v_profiles_total then
    raise exception 'FAIL: B8 expected % band memberships (one per profile), found %',
      v_profiles_total, v_memberships;
  end if;

  if exists (
    select 1
      from public.memberships m
      left join public.profiles p on p.id = m.user_id
      left join public.ensembles e on e.id = m.ensemble_id
     where p.id is null or e.id is null
  ) then
    raise exception 'FAIL: B9 memberships with a missing user or ensemble';
  end if;

  if exists (
    select 1 from public.memberships m
     join public.sections s on s.id = m.section_id
    where s.ensemble_id <> m.ensemble_id
  ) then
    raise exception 'FAIL: B10 a membership points at a section from another ensemble';
  end if;

  if exists (
    select 1 from public.memberships
     where ensemble_id = v_band
       and cardinality(coalesce(roles, '{}')) = 0
  ) then
    raise exception 'FAIL: B11 band membership with an empty roles array';
  end if;

  ---------------------------------------------------------------------------
  -- 6. Sections created for the distinct instruments (canonical + extras).
  --    `profiles.instrument` is the *source* of the sections, so these two
  --    assertions are only meaningful while the column still exists (018 drops
  --    it). Section integrity itself is covered by B10/B11.
  ---------------------------------------------------------------------------
  select count(*) into v_sections from public.sections where ensemble_id = v_band;
  if v_sections = 0 then
    raise exception 'FAIL: B12 no sections were created for band';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'instrument'
  ) then
    if exists (
      select 1 from public.profiles p
       where coalesce(trim(p.instrument), '') <> ''
         and not exists (
           select 1 from public.sections s
            where s.ensemble_id = v_band and s.name = trim(p.instrument)
         )
    ) then
      raise exception 'FAIL: B13 an instrument has no section of the same name';
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 7. Legacy values preserved (only while the legacy columns still exist)
  ---------------------------------------------------------------------------
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'roles'
  ) then
    select count(*) into v_roles_mismatch
      from public.profiles p
      join public.memberships m on m.user_id = p.id and m.ensemble_id = v_band
     where coalesce(p.roles, '{student}'::public.app_role[]) is distinct from m.roles;
    if v_roles_mismatch > 0 then
      raise exception 'FAIL: B14 % memberships did not preserve profiles.roles', v_roles_mismatch;
    end if;

    select count(*) into v_active_mismatch
      from public.profiles p
      join public.memberships m on m.user_id = p.id and m.ensemble_id = v_band
     where (not coalesce(p.deactivated, false)) is distinct from m.active;
    if v_active_mismatch > 0 then
      raise exception 'FAIL: B15 % memberships did not preserve the deactivated flag', v_active_mismatch;
    end if;

    select count(*) into v_section_mismatch
      from public.profiles p
      join public.memberships m on m.user_id = p.id and m.ensemble_id = v_band
     where coalesce(trim(p.instrument), '') <> ''
       and (m.section_id is null
            or m.section_id <> (select s.id from public.sections s
                                 where s.ensemble_id = v_band and s.name = trim(p.instrument)));
    if v_section_mismatch > 0 then
      raise exception 'FAIL: B16 % memberships did not resolve their section from the instrument',
        v_section_mismatch;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 8. Join code moved (checked while the legacy table still exists)
  ---------------------------------------------------------------------------
  select join_code into v_join_code from public.ensemble_settings where ensemble_id = v_band;
  if v_join_code is null then
    raise exception 'FAIL: B17 no ensemble_settings row for band';
  end if;

  if to_regclass('public.app_settings') is not null then
    if coalesce(v_join_code, '') is distinct from
       coalesce((select value from public.app_settings where key = 'band_join_code'), '') then
      raise exception 'FAIL: B18 band join code was not moved from app_settings';
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 9. Calendar source exists for band
  ---------------------------------------------------------------------------
  if not exists (select 1 from public.calendar_sources where ensemble_id = v_band) then
    raise exception 'FAIL: B19 no calendar source for band';
  end if;

  raise notice 'backfill summary: ensembles=1, events=%, memberships=%, sections=%, attendance=%, profiles=%',
    v_events_total, v_memberships, v_sections, v_attendance_total, v_profiles_total;
end $$;

rollback;

select 'BACKFILL VERIFICATION PASSED' as verification_result;
