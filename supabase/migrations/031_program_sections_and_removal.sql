-- ============================================================================
-- RHS Music Platform — Migration 031
-- Name a program's instruments when you create it; manage sections later;
-- and remove a person completely.
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- WHY. Two gaps, both about the shape of a program:
--
--   1. A newly created program had **no sections at all** (022 said so
--      explicitly), and there was no client path to create one afterwards —
--      `sections` has no write policy, and every RPC that touched sections only
--      *moved* a member between existing ones. So a teacher who started a
--      program could never put anybody in a section, and the roster, analytics
--      and attendance screens all grouped everyone under "No section".
--      Now `create_program()` accepts the instruments the director wants, and
--      the same director can add, rename or remove a section on the roster.
--
--   2. "Remove from the roster" was a soft deactivate: the membership stayed
--      with `active = false`, so the person still sat in the roster under
--      "Everyone" and their attendance history was untouched. `remove_member()`
--      is the complete removal: the membership and its role grants go, and so
--      does the attendance they accumulated in *this* program's history. Their
--      account and profile are deliberately kept (they may rejoin, or belong to
--      another program) — removal is about the roster, not the person.
--
-- SIGNATURE NOTE. `create_program()` gains a fifth parameter, and Postgres
-- cannot `create or replace` a function with a different argument list — so the
-- 4-argument version from 023 is dropped first. Every parameter after the name
-- keeps its default, so an existing 4-argument call still resolves.
--
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Normalise a section name once, so creation and the RPCs agree
-- ---------------------------------------------------------------------------
create or replace function public.normalize_section_name(p_name text)
returns text
language sql
immutable
as $$
  select left(btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g')), 40)
$$;

comment on function public.normalize_section_name(text) is
  'Trims, collapses whitespace and caps a section/instrument name at 40 characters.';

revoke all on function public.normalize_section_name(text) from public, anon;
grant execute on function public.normalize_section_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. create_program() — now takes the program's instruments
-- ---------------------------------------------------------------------------
-- The 4-argument teacher-gated wrapper (023) is replaced by a 5-argument one.
-- It still delegates the actual creation to `create_program_unchecked()`, so
-- the abuse guard, the slug, the join code and the director membership are
-- untouched; the only new work is inserting the sections.
drop function if exists public.create_program(text, text, text, text);

create or replace function public.create_program(
  p_name         text,
  p_short_name   text default null,
  p_display_name text default null,
  p_theme_color  text default null,
  p_instruments  text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth         text := public.current_auth_id();
  v_profile      uuid;
  v_account_type text;
  v_result       jsonb;
  v_ensemble     uuid;
  v_added        int := 0;
  v_raw          text;
  v_name         text;
  v_seen         text[] := '{}';
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  -- Teacher gate, exactly as 023 wrote it (unchanged behavior).
  select account_type into v_account_type
    from public.signup_account_types
   where auth_user_id = v_auth;

  if v_account_type = 'student' then
    return jsonb_build_object(
      'ok', false,
      'message', 'Student accounts join with a director''s code; only teacher accounts can start a program.'
    );
  end if;

  if v_account_type is distinct from 'teacher' then
    select id into v_profile
      from public.profiles
     where auth_user_id = v_auth;

    if v_profile is null or not public.is_director_anywhere(v_profile) then
      return jsonb_build_object(
        'ok', false,
        'message', 'Only teacher accounts can start a program. Join with a director''s code instead.'
      );
    end if;
  end if;

  v_result := public.create_program_unchecked(
    p_name,
    p_short_name,
    p_display_name,
    p_theme_color
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    return v_result;
  end if;

  v_ensemble := (v_result ->> 'program_id')::uuid;

  -- Sections from the instruments the director listed. Blank entries are
  -- skipped, duplicates (case-insensitively) collapse to the first spelling,
  -- and the list is capped so a pathological payload cannot fill the table.
  if p_instruments is not null then
    foreach v_raw in array p_instruments loop
      exit when v_added >= 60;

      v_name := public.normalize_section_name(v_raw);
      continue when v_name = '';
      continue when lower(v_name) = any (v_seen);

      v_seen := array_append(v_seen, lower(v_name));
      insert into public.sections (ensemble_id, name, sort_order)
      values (v_ensemble, v_name, v_added)
      on conflict (ensemble_id, name) do nothing;
      v_added := v_added + 1;
    end loop;
  end if;

  return v_result || jsonb_build_object('section_count', v_added);
end
$$;

comment on function public.create_program(text, text, text, text, text[]) is
  'Start a new program for a teacher account or an existing director, optionally creating one section per named instrument.';

revoke all on function public.create_program(text, text, text, text, text[]) from public, anon;
grant execute on function public.create_program(text, text, text, text, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Section management — directors only, one program at a time
-- ---------------------------------------------------------------------------
create or replace function public.add_program_section(p_ensemble uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := public.normalize_section_name(p_name);
  v_order int;
  v_id    uuid;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s director can change its sections.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', 'Give the section a name.');
  end if;
  if exists (
    select 1 from public.sections
     where ensemble_id = p_ensemble and lower(name) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'message', 'That section already exists.');
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_order
    from public.sections
   where ensemble_id = p_ensemble;

  insert into public.sections (ensemble_id, name, sort_order)
  values (p_ensemble, v_name, v_order)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'section_id', v_id,
    'name', v_name,
    'message', 'Section added.'
  );
end
$$;

comment on function public.add_program_section(uuid, text) is
  'Add one section (instrument) to a program. Director of that program only.';

create or replace function public.rename_program_section(p_section uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ens  uuid;
  v_name text := public.normalize_section_name(p_name);
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  select ensemble_id into v_ens from public.sections where id = p_section;
  if v_ens is null then
    return jsonb_build_object('ok', false, 'message', 'That section no longer exists.');
  end if;
  if not public.can_manage_ensemble(v_ens) then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s director can rename its sections.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', 'Give the section a name.');
  end if;
  if exists (
    select 1 from public.sections
     where ensemble_id = v_ens
       and id <> p_section
       and lower(name) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'message', 'Another section already has that name.');
  end if;

  update public.sections set name = v_name where id = p_section;

  return jsonb_build_object('ok', true, 'name', v_name, 'message', 'Section renamed.');
end
$$;

comment on function public.rename_program_section(uuid, text) is
  'Rename a section; everybody in it stays in it. Director of that program only.';

create or replace function public.remove_program_section(p_section uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ens     uuid;
  v_members int := 0;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  select ensemble_id into v_ens from public.sections where id = p_section;
  if v_ens is null then
    return jsonb_build_object('ok', false, 'message', 'That section no longer exists.');
  end if;
  if not public.can_manage_ensemble(v_ens) then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s director can remove its sections.');
  end if;

  select count(*) into v_members
    from public.memberships
   where section_id = p_section;

  -- memberships.section_id is `on delete set null`, so nobody is removed from
  -- the program — they simply fall under "No section" until they are moved.
  delete from public.sections where id = p_section;

  return jsonb_build_object(
    'ok', true,
    'moved_to_no_section', v_members,
    'message', case
      when v_members > 0 then 'Section removed — its members now show under "No section".'
      else 'Section removed.'
    end
  );
end
$$;

comment on function public.remove_program_section(uuid) is
  'Delete a section; its members keep their place on the roster with no section. Director only.';

revoke all on function public.add_program_section(uuid, text)     from public, anon;
revoke all on function public.rename_program_section(uuid, text)  from public, anon;
revoke all on function public.remove_program_section(uuid)        from public, anon;
grant execute on function public.add_program_section(uuid, text)    to authenticated, service_role;
grant execute on function public.rename_program_section(uuid, text) to authenticated, service_role;
grant execute on function public.remove_program_section(uuid)       to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. remove_member() — complete removal from one program
-- ---------------------------------------------------------------------------
-- Deletes, all scoped to this program:
--   * the person's attendance for this program's events (staff notes cascade)
--   * the reminder records that point at those events
--   * every custom role grant in this program (029)
--   * the membership itself
-- It deliberately does NOT touch the profile, the sign-in account, or anything
-- in another program: "completely removed" means off this roster, not deleted
-- as a person. It also never removes another director, and never yourself.
create or replace function public.remove_member(p_ensemble uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attendance int := 0;
  v_roles      int := 0;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not public.can_manage_ensemble(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s director can remove members.');
  end if;
  if p_member_id = public.current_profile_id() then
    return jsonb_build_object('ok', false, 'message', 'You cannot remove yourself from the program.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_member_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'They are not on this roster.');
  end if;
  if public.is_director_anywhere(p_member_id) and not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Directors cannot remove another director.');
  end if;

  with gone as (
    delete from public.attendance_records ar
     using public.events e
     where ar.event_id = e.id
       and e.ensemble_id = p_ensemble
       and ar.student_id = p_member_id
    returning 1
  )
  select count(*) into v_attendance from gone;

  delete from public.attendance_reminders r
   using public.events e
   where r.event_id = e.id
     and e.ensemble_id = p_ensemble
     and r.student_id = p_member_id;

  with gone as (
    delete from public.user_role_assignments a
     where a.user_id = p_member_id
       and a.ensemble_id = p_ensemble
    returning 1
  )
  select count(*) into v_roles from gone;

  delete from public.memberships
   where user_id = p_member_id
     and ensemble_id = p_ensemble;

  return jsonb_build_object(
    'ok', true,
    'attendance_deleted', v_attendance,
    'roles_deleted', v_roles,
    'message', 'Member removed — their place and attendance in this program are gone.'
  );
end
$$;

comment on function public.remove_member(uuid, uuid) is
  'Completely remove a person from one program: membership, role grants and their attendance history here. Keeps their account. Director only.';

revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Structural verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_def text;
begin
  if to_regprocedure('public.create_program(text, text, text, text, text[])') is null then
    raise exception 'FAIL: the 5-argument create_program() does not exist';
  end if;
  if to_regprocedure('public.create_program(text, text, text, text)') is not null then
    raise exception 'FAIL: the old 4-argument create_program() still exists';
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.create_program(text, text, text, text, text[])'::regprocedure
       and p.prosecdef
  ) then
    raise exception 'FAIL: create_program() must be SECURITY DEFINER';
  end if;

  -- It must still not accept anything it could be aimed at.
  v_def := lower(pg_get_function_arguments('public.create_program(text, text, text, text, text[])'::regprocedure));
  if v_def like '%ensemble%' or v_def like '%program_id%' or v_def like '%p_roles%' then
    raise exception 'FAIL: create_program() takes something it could be pointed at: %', v_def;
  end if;

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'create_program', 'add_program_section', 'rename_program_section',
       'remove_program_section', 'remove_member', 'normalize_section_name'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'FAIL: anon can execute: %', v_bad;
  end if;

  raise notice '031 structure OK: create_program takes instruments; section + removal RPCs exist; anon denied';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Functional verification — rolled back, so nothing is left behind
-- ---------------------------------------------------------------------------
-- A teacher creates a program naming instruments (with a blank, a duplicate and
-- stray whitespace), then adds, renames and removes a section. Everything runs
-- in a subtransaction that is rolled back on purpose; the sentinel is the only
-- escape, so a real failure still aborts the migration.
do $$
declare
  v_dir  constant uuid := '03100000-0000-4000-8000-000000000001';
  v_out  constant uuid := '03100000-0000-4000-8000-000000000003';
  v_prog uuid;
  v_r    jsonb;
  v_count int;
  v_names text;
  v_add  uuid;
  v_name text;
begin
  begin
    -- A teacher persona (the signup type is what create_program() checks).
    insert into public.signup_account_types (auth_user_id, account_type)
    values (v_dir::text, 'teacher')
    on conflict (auth_user_id) do nothing;

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_dir::text, 'role', 'authenticated')::text,
      true
    );

    v_r := public.create_program(
      '031 Verification Winds', 'V.W.', '031 Director', null,
      array['Flute', ' Clarinet ', 'flute', '', 'Saxophone', 'Flute']
    );
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: create_program with instruments refused: %', v_r ->> 'message';
    end if;
    if (v_r ->> 'section_count')::int <> 3 then
      raise exception 'FAIL: expected 3 sections created, got %', v_r ->> 'section_count';
    end if;

    v_prog := (v_r ->> 'program_id')::uuid;

    select count(*), string_agg(name, ', ' order by sort_order)
      into v_count, v_names
      from public.sections where ensemble_id = v_prog;
    if v_count <> 3 or v_names <> 'Flute, Clarinet, Saxophone' then
      raise exception 'FAIL: sections are wrong: % (%)', v_names, v_count;
    end if;

    -- Add: whitespace is trimmed, and the name comes back normalised.
    v_r := public.add_program_section(v_prog, '  Oboe  ');
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: add_program_section refused: %', v_r ->> 'message';
    end if;
    v_add := (v_r ->> 'section_id')::uuid;
    if (v_r ->> 'name') <> 'Oboe' then
      raise exception 'FAIL: add_program_section did not normalise the name: %', v_r ->> 'name';
    end if;

    -- A duplicate section (case-insensitive) and a blank one are refused.
    if coalesce((public.add_program_section(v_prog, 'oboe')) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: a duplicate section (different case) was accepted';
    end if;
    if coalesce((public.add_program_section(v_prog, '   ')) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: a blank section name was accepted';
    end if;

    -- Rename, then refuse renaming onto an existing name.
    v_r := public.rename_program_section(v_add, 'Oboe d''amore');
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: rename_program_section refused: %', v_r ->> 'message';
    end if;
    select name into v_name from public.sections where id = v_add;
    if v_name <> 'Oboe d''amore' then
      raise exception 'FAIL: rename did not stick: %', v_name;
    end if;
    if coalesce((public.rename_program_section(v_add, 'Flute')) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: renaming onto an existing section name was accepted';
    end if;

    -- Remove, and the count returns to the three originals.
    v_r := public.remove_program_section(v_add);
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: remove_program_section refused: %', v_r ->> 'message';
    end if;
    select count(*) into v_count from public.sections where ensemble_id = v_prog;
    if v_count <> 3 then
      raise exception 'FAIL: remove left % sections', v_count;
    end if;

    -- Somebody with no role in the program cannot change its sections.
    insert into public.profiles (id, auth_user_id, full_name, display_name)
    values (v_out, '031-outsider-auth', '031 Outsider', '031 Outsider')
    on conflict (id) do nothing;
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '031-outsider-auth', 'role', 'authenticated')::text,
      true
    );
    if coalesce((public.add_program_section(v_prog, 'Horn')) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: an outsider added a section';
    end if;

    raise exception 'ROLLBACK_031_FUNCTIONAL_CHECK';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_031_FUNCTIONAL_CHECK' then
        raise;
      end if;
  end;

  raise notice '031 sections OK: instruments became sections (blank/duplicate collapsed); add/rename/remove gated to the director';
end
$$;

-- A student is added and given attendance, then the director removes them: the
-- membership, the role grants and the attendance go, the profile and account
-- stay. Also rolled back.
do $$
declare
  v_dir    constant uuid := '03100000-0000-4000-8000-000000000001';
  v_member constant uuid := '03100000-0000-4000-8000-000000000002';
  v_prog   uuid;
  v_r      jsonb;
  v_att    int;
  v_mem    int;
  v_prof   int;
begin
  begin
    insert into public.signup_account_types (auth_user_id, account_type)
    values (v_dir::text, 'teacher')
    on conflict (auth_user_id) do nothing;

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_dir::text, 'role', 'authenticated')::text,
      true
    );

    v_r := public.create_program('031 Removal Program', null, '031 Director', null, array['Flute']);
    v_prog := (v_r ->> 'program_id')::uuid;

    insert into public.profiles (id, auth_user_id, full_name, display_name)
    values (v_member, '031-member-auth', '031 Member', '031 Member')
    on conflict (id) do nothing;

    insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
    values (v_member, v_prog,
            (select id from public.sections where ensemble_id = v_prog and name = 'Flute'),
            '{student}'::public.app_role[], true);

    insert into public.events (id, ensemble_id, name, type, date)
    values ('03100000-0000-4000-8000-0000000000e1', v_prog, '031 Rehearsal', 'rehearsal', now() - interval '1 day');

    insert into public.attendance_records (event_id, student_id, attended, status)
    values ('03100000-0000-4000-8000-0000000000e1', v_member, true, 'present');

    if (select count(*) from public.attendance_records where student_id = v_member) <> 1 then
      raise exception 'FAIL: fixture attendance was not written';
    end if;

    -- A student may not remove anybody.
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', '031-member-auth', 'role', 'authenticated')::text,
      true
    );
    if coalesce((public.remove_member(v_prog, v_member)) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: a student removed a member';
    end if;

    -- The director may.
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_dir::text, 'role', 'authenticated')::text,
      true
    );
    v_r := public.remove_member(v_prog, v_member);
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: remove_member refused the director: %', v_r ->> 'message';
    end if;
    if (v_r ->> 'attendance_deleted')::int <> 1 then
      raise exception 'FAIL: expected 1 attendance row deleted, got %', v_r ->> 'attendance_deleted';
    end if;

    select count(*) into v_mem from public.memberships
     where user_id = v_member and ensemble_id = v_prog;
    select count(*) into v_att from public.attendance_records where student_id = v_member;
    select count(*) into v_prof from public.profiles where id = v_member;

    if v_mem <> 0 then raise exception 'FAIL: the membership survived removal'; end if;
    if v_att <> 0 then raise exception 'FAIL: attendance survived removal'; end if;
    if v_prof <> 1 then raise exception 'FAIL: the profile was deleted — removal must keep the account'; end if;

    -- Removing them again is a clean refusal, not an error.
    if coalesce((public.remove_member(v_prog, v_member)) ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: removing an absent member was accepted';
    end if;

    raise exception 'ROLLBACK_031_REMOVAL_CHECK';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_031_REMOVAL_CHECK' then
        raise;
      end if;
  end;

  raise notice '031 removal OK: director removed membership + attendance, kept the profile; student refused';
end
$$;
