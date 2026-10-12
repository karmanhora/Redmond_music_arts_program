-- ============================================================================
-- RHS Music Platform — program sections (instruments) and complete removal
-- ============================================================================
-- requires-table: public.sections
--
-- Covers migration 031:
--   * a director names the program's instruments when they create it, and those
--     become its sections (blanks and case-insensitive duplicates collapsed);
--   * the director can add, rename and remove a section afterwards, and nobody
--     else can — not a secretary, not a student, and not another program's
--     director;
--   * `remove_member()` takes a person off one roster completely — membership,
--     custom role grants and their attendance in *that* program — while keeping
--     their account and leaving their other programs untouched.
--
-- Every persona is fictional and the whole suite runs in ONE transaction that is
-- ROLLED BACK. Prints PROGRAM SECTIONS AND REMOVAL PASSED on success.
-- ============================================================================

begin;

-- No caller yet: the fixtures are inserted as the owner, and guards that read
-- `request.jwt.claims` must see "no actor" rather than a leftover persona.
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  if to_regprocedure('public.create_program(text, text, text, text, text[])') is null then
    raise exception 'FAIL: S&R-0 create_program(…, text[]) missing — apply migration 031 first';
  end if;
  if to_regprocedure('public.remove_member(uuid, uuid)') is null then
    raise exception 'FAIL: S&R-0 remove_member() missing — apply migration 031 first';
  end if;
  if to_regprocedure('public.add_program_section(uuid, text)') is null then
    raise exception 'FAIL: S&R-0 add_program_section() missing — apply migration 031 first';
  end if;
end
$$;

create or replace function public.sr_assert(condition boolean, label text)
returns void
language plpgsql
as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two programs. A has a director, a second director, a secretary and two
-- students; B has its own director, and one student who is also in A.
insert into public.ensembles (id, slug, name, short_name, active) values
  ('031a0000-0000-4000-8000-0000000000a1', 'sr-program-a', 'SR Program A', 'SR A', true),
  ('031b0000-0000-4000-8000-0000000000b1', 'sr-program-b', 'SR Program B', 'SR B', true)
on conflict (slug) do nothing;

insert into public.sections (id, ensemble_id, name, sort_order) values
  ('031a0000-0000-4000-8000-000000000011', '031a0000-0000-4000-8000-0000000000a1', 'SR Violin', 0),
  ('031b0000-0000-4000-8000-000000000011', '031b0000-0000-4000-8000-0000000000b1', 'SR Cello',  0)
on conflict (ensemble_id, name) do nothing;

insert into public.ensemble_settings (ensemble_id, join_code) values
  ('031a0000-0000-4000-8000-0000000000a1', 'SRCODEA1'),
  ('031b0000-0000-4000-8000-0000000000b1', 'SRCODEB1')
on conflict (ensemble_id) do nothing;

insert into public.profiles (id, auth_user_id, full_name, display_name) values
  ('031d0000-0000-4000-8000-000000000001', 'sr-dir-a', 'SR Director A',  'Dir A'),
  ('031d0000-0000-4000-8000-000000000002', 'sr-dir-b', 'SR Director B',  'Dir B'),
  ('031d0000-0000-4000-8000-000000000003', 'sr-sec-a', 'SR Secretary A', 'Sec A'),
  ('031d0000-0000-4000-8000-000000000004', 'sr-stu-1', 'SR Student One', 'Stu One'),
  ('031d0000-0000-4000-8000-000000000005', 'sr-stu-2', 'SR Student Two', 'Stu Two'),
  ('031d0000-0000-4000-8000-000000000006', 'sr-dir-c', 'SR Director C',  'Dir C')
on conflict (id) do nothing;

insert into public.memberships (user_id, ensemble_id, section_id, roles, active) values
  ('031d0000-0000-4000-8000-000000000001', '031a0000-0000-4000-8000-0000000000a1', null, '{director}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000006', '031a0000-0000-4000-8000-0000000000a1', null, '{director}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000003', '031a0000-0000-4000-8000-0000000000a1', null, '{secretary}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000004', '031a0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-000000000011', '{student}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000005', '031a0000-0000-4000-8000-0000000000a1', '031a0000-0000-4000-8000-000000000011', '{student}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000002', '031b0000-0000-4000-8000-0000000000b1', null, '{director}'::public.app_role[], true),
  ('031d0000-0000-4000-8000-000000000004', '031b0000-0000-4000-8000-0000000000b1', '031b0000-0000-4000-8000-000000000011', '{student}'::public.app_role[], true)
on conflict (user_id, ensemble_id) do nothing;

-- Custom role grant, to prove removal takes it too.
insert into public.user_role_assignments (user_id, ensemble_id, role_id)
select '031d0000-0000-4000-8000-000000000005',
       '031a0000-0000-4000-8000-0000000000a1',
       r.id
  from public.roles r
 where r.key = 'student'
on conflict (user_id, ensemble_id, role_id) do nothing;

insert into public.events (id, ensemble_id, name, type, date) values
  ('031a0000-0000-4000-8000-0000000000e1', '031a0000-0000-4000-8000-0000000000a1', 'SR A Rehearsal', 'rehearsal', now() - interval '2 days'),
  ('031b0000-0000-4000-8000-0000000000e1', '031b0000-0000-4000-8000-0000000000b1', 'SR B Rehearsal', 'rehearsal', now() - interval '2 days')
on conflict (id) do nothing;

insert into public.attendance_records (event_id, student_id, attended, status) values
  ('031a0000-0000-4000-8000-0000000000e1', '031d0000-0000-4000-8000-000000000004', true, 'present'),
  ('031a0000-0000-4000-8000-0000000000e1', '031d0000-0000-4000-8000-000000000005', true, 'present'),
  ('031b0000-0000-4000-8000-0000000000e1', '031d0000-0000-4000-8000-000000000004', true, 'present')
on conflict (event_id, student_id) do nothing;

-- ---------------------------------------------------------------------------
-- A. Sections are created with the program
-- ---------------------------------------------------------------------------
do $$
declare
  v_persona constant text := 'sr-new-teacher';
  v_r       jsonb;
  v_prog    uuid;
  v_count   int;
  v_names   text;
begin
  insert into public.signup_account_types (auth_user_id, account_type)
  values (v_persona, 'teacher')
  on conflict (auth_user_id) do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_persona, 'role', 'authenticated')::text, true);
  set role authenticated;

  v_r := public.create_program(
    'SR Starter Strings', 'SRS', 'SR Teacher', null,
    array['Violin', 'violin', '  Viola  ', '', 'Cello']
  );
  reset role;

  perform public.sr_assert(coalesce(v_r ->> 'ok', 'false') = 'true',
    'A1 a teacher created a program with instruments: ' || coalesce(v_r ->> 'message', '(none)'));
  perform public.sr_assert((v_r ->> 'section_count')::int = 3,
    'A2 blanks and case-duplicate instruments collapse to three sections, got ' || coalesce(v_r ->> 'section_count', '?'));

  v_prog := (v_r ->> 'program_id')::uuid;

  select count(*), string_agg(name, ', ' order by sort_order)
    into v_count, v_names
    from public.sections where ensemble_id = v_prog;
  perform public.sr_assert(v_count = 3 and v_names = 'Violin, Viola, Cello',
    'A3 sections are Violin, Viola, Cello in order — got ' || coalesce(v_names, '?'));

  -- A program created without instruments still has none, and that is fine.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_persona, 'role', 'authenticated')::text, true);
  set role authenticated;
  v_r := public.create_program('SR No Instruments', null, 'SR Teacher', null);
  reset role;
  v_prog := (v_r ->> 'program_id')::uuid;
  perform public.sr_assert(
    coalesce(v_r ->> 'ok', 'false') = 'true'
      and (select count(*) from public.sections where ensemble_id = v_prog) = 0,
    'A4 a program created with no instruments simply has no sections');
end
$$;

-- ---------------------------------------------------------------------------
-- B. Managing sections afterwards
-- ---------------------------------------------------------------------------
do $$
declare
  v_a   constant uuid := '031a0000-0000-4000-8000-0000000000a1';
  v_r   jsonb;
  v_sec uuid;
  v_name text;
begin
  -- B1: the director adds one.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.add_program_section(v_a, '  SR Viola  ');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'false') = 'true' and (v_r ->> 'name') = 'SR Viola',
    'B1 the director added a section (normalised)');
  v_sec := (v_r ->> 'section_id')::uuid;

  -- B2: a duplicate is refused.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.add_program_section(v_a, 'sr viola');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'B2 a duplicate section name (different case) is refused');

  -- B3: rename keeps the members.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.rename_program_section(v_sec, 'SR Viola da gamba');
  reset role;
  select name into v_name from public.sections where id = v_sec;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'false') = 'true' and v_name = 'SR Viola da gamba',
    'B3 the director renamed a section');

  -- B4: renaming onto an existing name is refused.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.rename_program_section(v_sec, 'SR Violin');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'B4 renaming onto an existing section name is refused');

  -- B5: a secretary (staff, but not a director) may not.
  perform set_config('request.jwt.claims', '{"sub":"sr-sec-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.add_program_section(v_a, 'SR Trumpet');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'B5 a secretary cannot add a section');

  -- B6: a student may not.
  perform set_config('request.jwt.claims', '{"sub":"sr-stu-1","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.add_program_section(v_a, 'SR Oboe');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'B6 a student cannot add a section');

  -- B7: another program's director may not touch this one.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-b","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.add_program_section(v_a, 'SR Horn');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'B7 a director of another program cannot change this program''s sections');

  -- B8: removing a section leaves its members on the roster with no section.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_program_section('031a0000-0000-4000-8000-000000000011');
  reset role;
  perform public.sr_assert(
    coalesce(v_r ->> 'ok', 'false') = 'true'
      and (v_r ->> 'moved_to_no_section')::int = 2
      and (select count(*) from public.memberships
            where ensemble_id = v_a and section_id is null and roles = '{student}') = 2,
    'B8 removing a section moves its members to No section, so nobody is removed');
end
$$;

-- ---------------------------------------------------------------------------
-- C. remove_member — complete, program-scoped removal
-- ---------------------------------------------------------------------------
do $$
declare
  v_a  constant uuid := '031a0000-0000-4000-8000-0000000000a1';
  v_b  constant uuid := '031b0000-0000-4000-8000-0000000000b1';
  v_s2 constant uuid := '031d0000-0000-4000-8000-000000000005';
  v_r  jsonb;
begin
  -- C1: a student cannot remove anyone.
  perform set_config('request.jwt.claims', '{"sub":"sr-stu-1","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, v_s2);
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'C1 a student cannot remove a member');
  perform public.sr_assert(
    (select count(*) from public.memberships where user_id = v_s2 and ensemble_id = v_a) = 1,
    'C1b the refused call changed nothing');

  -- C2: a secretary cannot either.
  perform set_config('request.jwt.claims', '{"sub":"sr-sec-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, v_s2);
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'C2 a secretary cannot remove a member');

  -- C3: a director cannot remove another director.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, '031d0000-0000-4000-8000-000000000006');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'C3 a director cannot remove another director');

  -- C4: a director cannot remove themselves.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, '031d0000-0000-4000-8000-000000000001');
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'C4 a director cannot remove themselves');

  -- C5: the director removes a student — everything in A goes, the account stays.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, v_s2);
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'false') = 'true',
    'C5 the director removed a member: ' || coalesce(v_r ->> 'message', '(none)'));
  perform public.sr_assert(
    (select count(*) from public.memberships where user_id = v_s2 and ensemble_id = v_a) = 0,
    'C5b the membership is gone');
  perform public.sr_assert(
    (select count(*) from public.attendance_records ar
      join public.events e on e.id = ar.event_id
     where ar.student_id = v_s2 and e.ensemble_id = v_a) = 0,
    'C5c their attendance in this program is gone');
  perform public.sr_assert(
    (select count(*) from public.user_role_assignments
      where user_id = v_s2 and ensemble_id = v_a) = 0,
    'C5d their custom role grants in this program are gone');
  perform public.sr_assert(
    (select count(*) from public.profiles where id = v_s2) = 1,
    'C5e the account/profile is kept — only the roster place is removed');

  -- C6: removal is scoped to one program. Student One is in A and B.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, '031d0000-0000-4000-8000-000000000004');
  reset role;
  perform public.sr_assert(
    coalesce(v_r ->> 'ok', 'false') = 'true'
      and (select count(*) from public.memberships
            where user_id = '031d0000-0000-4000-8000-000000000004'
              and ensemble_id = v_a) = 0
      and (select count(*) from public.memberships
            where user_id = '031d0000-0000-4000-8000-000000000004'
              and ensemble_id = v_b) = 1,
    'C6 removing someone from A leaves their membership in B untouched');
  perform public.sr_assert(
    (select count(*) from public.attendance_records ar
      join public.events e on e.id = ar.event_id
     where ar.student_id = '031d0000-0000-4000-8000-000000000004' and e.ensemble_id = v_b) = 1,
    'C6b their attendance in the other program is untouched');

  -- C7: removing an absent member is a clean refusal.
  perform set_config('request.jwt.claims', '{"sub":"sr-dir-a","role":"authenticated"}', true);
  set role authenticated;
  v_r := public.remove_member(v_a, v_s2);
  reset role;
  perform public.sr_assert(coalesce(v_r ->> 'ok', 'true') = 'false',
    'C7 removing somebody who is not on the roster is refused');
end
$$;

-- ---------------------------------------------------------------------------
-- D. anon can reach none of the new surface
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_program', 'add_program_section', 'rename_program_section',
                       'remove_program_section', 'remove_member', 'normalize_section_name')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform public.sr_assert(v_bad is null, 'D1 anon can execute: ' || coalesce(v_bad, ''));
end
$$;

select 'PROGRAM SECTIONS AND REMOVAL PASSED' as verification_result;

rollback;
