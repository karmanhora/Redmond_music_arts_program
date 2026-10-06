-- ============================================================================
-- ensemble_isolation.sql — Phase 2 gate: two programs cannot see each other
-- ============================================================================
-- requires-table: public.memberships
--
-- Creates TWO throwaway programs (`test-alpha`, `test-beta`) and a cast of
-- personas — including a section leader in each program whose section is
-- literally named "Violin" in both, and one student who belongs to BOTH
-- programs — and then asserts, persona by persona, that nothing crosses over:
--
--   events · attendance · staff notes · sections · analytics · member
--   management · join codes · calendar sync · notification fan-out
--
-- Design (same shape as security_verification.sql):
--   * Everything runs in one transaction and is ROLLED BACK at the end.
--   * Personas are authenticated exactly the way PostgREST sees a Clerk token:
--       set role authenticated;
--       set_config('request.jwt.claims', '{"sub":"<clerk_id>",…}', true)
--     so RLS, `current_profile_id()` and every SECURITY DEFINER check behave as
--     they do for a real client. No `auth.users` rows are involved any more —
--     `profiles.clerk_id` IS the identity.
--   * Each check raises 'FAIL: ISO-<n> …' on the first violation.
--   * On success the script prints: ENSEMBLE ISOLATION PASSED.
-- ============================================================================

begin;

-- Fixture inserts must not fan out notifications; ISO-14 turns them back on.
select set_config('app.suppress_event_notifications', 'true', true);

-- ---------------------------------------------------------------------------
-- 0. Assertion helper (created inside the transaction — rolled back with it)
-- ---------------------------------------------------------------------------
create or replace function public.t_assert(condition boolean, label text)
returns void
language plpgsql
as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
end;
$$;

grant execute on function public.t_assert(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Fixtures
-- ---------------------------------------------------------------------------
-- Programs
insert into public.ensembles (id, slug, name, short_name, theme_color) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'test-alpha', 'TST Alpha', 'Alpha', '#111111'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'test-beta',  'TST Beta',  'Beta',  '#222222');

insert into public.ensemble_theme_tokens (ensemble_id, tokens) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '{"primary":"#111111"}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '{"primary":"#222222"}'::jsonb);

insert into public.ensemble_settings (ensemble_id, join_code) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'ALPHA9'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'BETA9');

insert into public.calendar_sources (id, ensemble_id, provider, ics_url, name) values
  ('cccccccc-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   'google_ics', 'https://example.test/alpha.ics', 'TST Alpha feed'),
  ('cccccccc-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-0000000000b1',
   'google_ics', 'https://example.test/beta.ics', 'TST Beta feed');

-- Sections — deliberately the SAME name ("Violin") in both programs.
insert into public.sections (id, ensemble_id, name, sort_order) values
  ('51111111-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Violin', 1),
  ('51111111-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-0000000000a1', 'Cello',  2),
  ('52222222-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'Violin', 1),
  ('52222222-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'Viola',  2);

-- Personas (profiles.clerk_id is the identity the JWT `sub` claim carries).
insert into public.profiles (id, clerk_id, full_name, display_name) values
  ('d0000001-0000-4000-8000-000000000001', 'iso-alpha-dir',      'TST Alpha Director',   'TST Alpha Director'),
  ('d0000001-0000-4000-8000-000000000002', 'iso-alpha-sec',      'TST Alpha Secretary',  'TST Alpha Secretary'),
  ('d0000001-0000-4000-8000-000000000003', 'iso-alpha-lead',     'TST Alpha V Leader',   'TST Alpha V Leader'),
  ('d0000001-0000-4000-8000-000000000004', 'iso-alpha-student',  'TST Alpha V Student',  'TST Alpha V Student'),
  ('d0000001-0000-4000-8000-000000000005', 'iso-alpha-cello',    'TST Alpha C Student',  'TST Alpha C Student'),
  ('d0000002-0000-4000-8000-000000000001', 'iso-beta-dir',       'TST Beta Director',    'TST Beta Director'),
  ('d0000002-0000-4000-8000-000000000002', 'iso-beta-lead',      'TST Beta V Leader',    'TST Beta V Leader'),
  ('d0000002-0000-4000-8000-000000000003', 'iso-beta-student',   'TST Beta V Student',   'TST Beta V Student'),
  ('d0000003-0000-4000-8000-000000000001', 'iso-prog-admin',     'TST Program Admin',    'TST Program Admin'),
  ('d0000004-0000-4000-8000-000000000001', 'iso-both-student',   'TST Both Student',     'TST Both Student');

insert into public.program_admins (user_id) values
  ('d0000003-0000-4000-8000-000000000001');

insert into public.memberships (user_id, ensemble_id, section_id, roles, active) values
  ('d0000001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1', null, '{director}'::public.app_role[], true),
  ('d0000001-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-0000000000a1', null, '{secretary}'::public.app_role[], true),
  ('d0000001-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-0000000000a1', '51111111-0000-4000-8000-0000000000a1', '{section_leader}'::public.app_role[], true),
  ('d0000001-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-0000000000a1', '51111111-0000-4000-8000-0000000000a1', '{student}'::public.app_role[], true),
  ('d0000001-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-0000000000a1', '51111111-0000-4000-8000-0000000000a2', '{student}'::public.app_role[], true),
  ('d0000002-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000b1', null, '{director}'::public.app_role[], true),
  ('d0000002-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-0000000000b1', '52222222-0000-4000-8000-0000000000b1', '{section_leader}'::public.app_role[], true),
  ('d0000002-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-0000000000b1', '52222222-0000-4000-8000-0000000000b1', '{student}'::public.app_role[], true),
  ('d0000004-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-0000000000a1', '51111111-0000-4000-8000-0000000000a1', '{student}'::public.app_role[], true),
  ('d0000004-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000b1', '52222222-0000-4000-8000-0000000000b1', '{student}'::public.app_role[], true);

-- One event per program, plus a Google-synced event in each program so the
-- sync scoping check has something to preserve.
insert into public.events
  (id, name, type, event_type, date, checkin_mode, attendance_requirement,
   ensemble_id, created_by, event_source, late_minutes)
values
  ('e0000001-0000-4000-8000-000000000011', 'TST Alpha Rehearsal', 'Rehearsal', 'rehearsal',
   now() - interval '1 hour', 'qr', 'required',
   'aaaaaaaa-0000-4000-8000-0000000000a1', 'd0000001-0000-4000-8000-000000000001', 'manual', 10),
  ('e0000002-0000-4000-8000-000000000001', 'TST Beta Rehearsal', 'Rehearsal', 'rehearsal',
   now() - interval '1 hour', 'qr', 'required',
   'bbbbbbbb-0000-4000-8000-0000000000b1', 'd0000002-0000-4000-8000-000000000001', 'manual', 10),
  ('e0000001-0000-4000-8000-0000000000f1', 'TST Alpha Google(old)', 'Rehearsal', 'rehearsal',
   now() - interval '10 days', 'qr', 'required',
   'aaaaaaaa-0000-4000-8000-0000000000a1', null, 'google_calendar', 10),
  ('e0000002-0000-4000-8000-0000000000f1', 'TST Beta Google(old)', 'Rehearsal', 'rehearsal',
   now() - interval '10 days', 'qr', 'required',
   'bbbbbbbb-0000-4000-8000-0000000000b1', null, 'google_calendar', 10);

update public.events
   set google_calendar_uid = 'iso-uid-alpha-old'
 where id = 'e0000001-0000-4000-8000-0000000000f1';
update public.events
   set google_calendar_uid = 'iso-uid-beta-old'
 where id = 'e0000002-0000-4000-8000-0000000000f1';

-- A QR session in each program (the record RPC accepts any unexpired token).
insert into public.checkin_sessions (event_id, token, entry_code, created_by, expires_at) values
  ('e0000001-0000-4000-8000-000000000011', 'iso-tok-alpha', 'ALPHA123',
   'd0000001-0000-4000-8000-000000000001', now() + interval '5 minutes'),
  ('e0000002-0000-4000-8000-000000000001', 'iso-tok-beta',  'BETA1234',
   'd0000002-0000-4000-8000-000000000001', now() + interval '5 minutes');

-- ---------------------------------------------------------------------------
-- 2. Beta director seeds Beta attendance + a Beta staff note first, so the
--    Alpha persona below has something real to fail to see.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-beta-dir","role":"authenticated"}', true);
  set role authenticated;

  v := public.override_attendance('e0000002-0000-4000-8000-000000000001',
                                  'd0000002-0000-4000-8000-000000000003',
                                  'present', '', 'TST-NOTE-BETA');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-2b beta director could not mark their own student: ' || coalesce(v ->> 'message', '?'));
  perform public.t_assert(
    exists (select 1 from public.attendance_records
             where event_id = 'e0000002-0000-4000-8000-000000000001'
               and student_id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-2b beta director cannot read the attendance they just marked');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 3. Alpha director: owns Alpha, blind to Beta
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-alpha-dir","role":"authenticated"}', true);
  set role authenticated;

  -- ISO-1 — events are program-scoped
  perform public.t_assert(
    exists (select 1 from public.events where id = 'e0000001-0000-4000-8000-000000000011'),
    'ISO-1 alpha director cannot read their own event');
  perform public.t_assert(
    not exists (select 1 from public.events where id = 'e0000002-0000-4000-8000-000000000001'),
    'ISO-1 alpha director can read a Beta event');

  -- Seed Alpha attendance through the real staff RPC (also proves the path).
  v := public.override_attendance('e0000001-0000-4000-8000-000000000011',
                                  'd0000001-0000-4000-8000-000000000004',
                                  'present', '', 'TST-NOTE-ALPHA');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-1 alpha director could not mark their own student: ' || coalesce(v ->> 'message', '?'));

  -- ISO-2 — Beta attendance is invisible and untouchable
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where event_id = 'e0000002-0000-4000-8000-000000000001'),
    'ISO-2 alpha director can read Beta attendance');
  v := public.override_attendance('e0000002-0000-4000-8000-000000000001',
                                  'd0000002-0000-4000-8000-000000000003',
                                  'present');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-2 alpha director could override Beta attendance');

  -- ISO-3 — staff notes never cross programs (the Beta note exists by now)
  perform public.t_assert(
    exists (select 1 from public.attendance_staff_notes where staff_note = 'TST-NOTE-ALPHA'),
    'ISO-3 alpha director cannot read their own staff note');
  perform public.t_assert(
    not exists (select 1 from public.attendance_staff_notes where staff_note = 'TST-NOTE-BETA'),
    'ISO-3 alpha director can read a Beta staff note');

  -- ISO-8 — analytics are program-scoped
  v := public.get_section_attendance_stats('aaaaaaaa-0000-4000-8000-0000000000a1');
  perform public.t_assert(jsonb_typeof(v) = 'array',
    'ISO-8 alpha director analytics did not return rows: ' || coalesce(v ->> 'message', '?'));
  perform public.t_assert(
    not exists (
      select 1 from jsonb_array_elements(v) e
       where (e ->> 'section') not in (
         select s.name from public.sections s
          where s.ensemble_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
       )
    ),
    'ISO-8 alpha analytics leaked a section from another program');

  v := public.get_section_attendance_stats('bbbbbbbb-0000-4000-8000-0000000000b1');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-8 alpha director can read Beta analytics');

  -- ISO-9 — a student percentage is only readable for your own program
  v := public.get_student_attendance_pct('d0000002-0000-4000-8000-000000000003',
                                        'bbbbbbbb-0000-4000-8000-0000000000b1');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-9 alpha director can read a Beta student percentage');
  v := public.get_student_attendance_pct('d0000001-0000-4000-8000-000000000004',
                                        'aaaaaaaa-0000-4000-8000-0000000000a1');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-9 alpha director cannot read their own student percentage');

  -- ISO-10 — member management cannot reach another program's roster
  v := public.deactivate_member('aaaaaaaa-0000-4000-8000-0000000000a1',
                               'd0000002-0000-4000-8000-000000000003');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-10 alpha director deactivated a Beta member');
  v := public.set_member_section('aaaaaaaa-0000-4000-8000-0000000000a1',
                                'd0000002-0000-4000-8000-000000000003',
                                '51111111-0000-4000-8000-0000000000a1');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-10 alpha director moved a Beta member into an Alpha section');
  -- ...and an Alpha member cannot be moved into a Beta section.
  v := public.set_member_section('aaaaaaaa-0000-4000-8000-0000000000a1',
                                'd0000001-0000-4000-8000-000000000004',
                                '52222222-0000-4000-8000-0000000000b1');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-10 alpha director assigned a Beta section to an Alpha member');

  -- ISO-12 — join codes are per program
  v := public.get_join_code('aaaaaaaa-0000-4000-8000-0000000000a1');
  perform public.t_assert(v ->> 'ok' = 'true' and v ->> 'code' = 'ALPHA9',
    'ISO-12 alpha director join code wrong: ' || coalesce(v ->> 'code', '?'));
  v := public.get_join_code('bbbbbbbb-0000-4000-8000-0000000000b1');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-12 alpha director can read the Beta join code');
  v := public.set_join_code('aaaaaaaa-0000-4000-8000-0000000000a1', 'NEWCODE1');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-12 alpha director could not rotate their own join code');
  v := public.set_join_code('bbbbbbbb-0000-4000-8000-0000000000b1', 'HIJACKED');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-12 alpha director could set the Beta join code');

  -- ISO-13 — a sync touches only its own program's calendar
  v := public.sync_google_calendar_events(
    'cccccccc-0000-4000-8000-0000000000a1',
    '[{"uid":"iso-uid-alpha-new","name":"TST Alpha synced","type":"Rehearsal","date":"2030-01-01T10:00:00Z"}]'::jsonb,
    false
  );
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-13 alpha sync failed: ' || coalesce(v ->> 'message', '?'));
  perform public.t_assert(
    exists (select 1 from public.events
             where google_calendar_uid = 'iso-uid-alpha-new'
               and ensemble_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'),
    'ISO-13 synced event missing or not scoped to Alpha');
  perform public.t_assert(
    not exists (select 1 from public.events
                 where google_calendar_uid = 'iso-uid-beta-old' and archived = true),
    'ISO-13 alpha sync archived a Beta event');
  perform public.t_assert(
    not exists (select 1 from public.events where google_calendar_uid = 'iso-uid-beta-new'),
    'ISO-13 alpha sync created a Beta event');

  -- A director cannot sync another program's feed at all.
  v := public.sync_google_calendar_events(
    'cccccccc-0000-4000-8000-0000000000b1',
    '[{"uid":"iso-uid-hijack","name":"hijack","type":"Rehearsal","date":"2030-01-01T10:00:00Z"}]'::jsonb,
    false
  );
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-13 alpha director could sync the Beta feed');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 4. Beta director: mirror image
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-beta-dir","role":"authenticated"}', true);
  set role authenticated;

  perform public.t_assert(
    not exists (select 1 from public.events where id = 'e0000001-0000-4000-8000-000000000011'),
    'ISO-2c beta director can read an Alpha event');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where event_id = 'e0000001-0000-4000-8000-000000000011'),
    'ISO-2d beta director can read Alpha attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_staff_notes where staff_note = 'TST-NOTE-ALPHA'),
    'ISO-3b beta director can read an Alpha staff note');
  perform public.t_assert(
    not exists (select 1 from public.memberships
                 where ensemble_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'),
    'ISO-2e beta director can read Alpha memberships');

  v := public.get_student_attendance_pct('d0000002-0000-4000-8000-000000000003',
                                        'bbbbbbbb-0000-4000-8000-0000000000b1');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-9b beta director cannot read their own student percentage');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 5. Section leaders: the same section NAME in two programs, fully separate
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-alpha-lead","role":"authenticated"}', true);
  set role authenticated;

  -- ISO-7 — their own section only, inside their own program
  perform public.t_assert(
    exists (select 1 from public.attendance_records
             where student_id = 'd0000001-0000-4000-8000-000000000004'),
    'ISO-7 alpha Violin leader cannot read their own section''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000001-0000-4000-8000-000000000005'),
    'ISO-7 alpha Violin leader can read the Cello student''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-7 alpha Violin leader can read a Beta student''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_staff_notes where staff_note = 'TST-NOTE-BETA'),
    'ISO-7 alpha Violin leader can read a Beta staff note');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-beta-lead","role":"authenticated"}', true);
  set role authenticated;

  -- A "Violin" leader in Beta gets nothing in Alpha, even though the section
  -- name matches — sections belong to exactly one program.
  perform public.t_assert(
    exists (select 1 from public.attendance_records
             where student_id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-7b beta Violin leader cannot read their own section''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000001-0000-4000-8000-000000000004'),
    'ISO-7c beta Violin leader can read Alpha''s Violin student');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000001-0000-4000-8000-000000000005'),
    'ISO-7d beta Violin leader can read an Alpha student');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 6. Students: own row, own roster — never another program's
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-alpha-student","role":"authenticated"}', true);
  set role authenticated;

  -- ISO-4 — own attendance row is readable, a Beta row is not
  perform public.t_assert(
    exists (select 1 from public.attendance_records
             where student_id = 'd0000001-0000-4000-8000-000000000004'),
    'ISO-4 alpha student cannot read their own attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-4 alpha student can read a Beta student''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_records
                 where student_id = 'd0000001-0000-4000-8000-000000000005'),
    'ISO-4 alpha student can read the Cello student''s attendance');
  perform public.t_assert(
    not exists (select 1 from public.attendance_staff_notes),
    'ISO-4b alpha student can read staff notes');

  -- ISO-4c — co-members only
  perform public.t_assert(
    exists (select 1 from public.profiles where id = 'd0000001-0000-4000-8000-000000000003'),
    'ISO-4c alpha student cannot read a co-member profile');
  perform public.t_assert(
    not exists (select 1 from public.profiles where id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-4c alpha student can read a Beta profile');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-both-student","role":"authenticated"}', true);
  set role authenticated;

  -- ISO-5 — a member of both programs sees both rosters, still no notes
  perform public.t_assert(
    (select count(*) from public.memberships
      where user_id = 'd0000004-0000-4000-8000-000000000001') = 2,
    'ISO-5 the both-programs student cannot read their own two memberships');
  perform public.t_assert(
    exists (select 1 from public.profiles where id = 'd0000001-0000-4000-8000-000000000004'),
    'ISO-5 the both-programs student cannot read an Alpha co-member');
  perform public.t_assert(
    exists (select 1 from public.profiles where id = 'd0000002-0000-4000-8000-000000000003'),
    'ISO-5 the both-programs student cannot read a Beta co-member');
  perform public.t_assert(
    not exists (select 1 from public.attendance_staff_notes),
    'ISO-5b the both-programs student can read staff notes');
  perform public.t_assert(
    (select count(*) from public.ensembles) = 2,
    'ISO-5c the both-programs student cannot read both programs'' rows');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 7. Program admin: sees everything, belongs to nothing
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-prog-admin","role":"authenticated"}', true);
  set role authenticated;

  perform public.t_assert(
    exists (select 1 from public.events where id = 'e0000001-0000-4000-8000-000000000011')
    and exists (select 1 from public.events where id = 'e0000002-0000-4000-8000-000000000001'),
    'ISO-6 program admin cannot read both programs'' events');
  perform public.t_assert(
    exists (select 1 from public.memberships
             where ensemble_id = 'aaaaaaaa-0000-4000-8000-0000000000a1')
    and exists (select 1 from public.memberships
                 where ensemble_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
    'ISO-6 program admin cannot read both programs'' memberships');
  perform public.t_assert(
    (public.get_section_attendance_stats('aaaaaaaa-0000-4000-8000-0000000000a1')) is not null
    and (public.get_section_attendance_stats('bbbbbbbb-0000-4000-8000-0000000000b1')) is not null,
    'ISO-6 program admin cannot read both programs'' analytics');
  perform public.t_assert(
    public.is_program_admin(),
    'ISO-6 is_program_admin() is false for the program admin');
  perform public.t_assert(
    not public.is_member_of('aaaaaaaa-0000-4000-8000-0000000000a1'),
    'ISO-6 program admin is wrongly considered a member');
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 8. Secretary: staff inside one program only (policy WITH CHECK)
-- ---------------------------------------------------------------------------
do $$
declare
  v_state text;
begin
  perform set_config('request.jwt.claims', '{"sub":"iso-alpha-sec","role":"authenticated"}', true);
  set role authenticated;

  -- ISO-11 — inserting into the other program must be rejected by RLS.
  begin
    insert into public.events
      (name, type, event_type, date, checkin_mode, attendance_requirement,
       ensemble_id, created_by, event_source)
    values
      ('TST ISO cross-program insert', 'Rehearsal', 'rehearsal', now(), 'qr', 'required',
       'bbbbbbbb-0000-4000-8000-0000000000b1', 'd0000001-0000-4000-8000-000000000002', 'manual');
    v_state := 'INSERTED';
  exception
    when others then
      v_state := sqlstate;
  end;
  perform public.t_assert(v_state = '42501',
    format('ISO-11 alpha secretary could insert into Beta (sqlstate %s)', v_state));

  -- ...and the same insert into their own program is allowed.
  begin
    insert into public.events
      (name, type, event_type, date, checkin_mode, attendance_requirement,
       ensemble_id, created_by, event_source)
    values
      ('TST ISO own-program insert', 'Rehearsal', 'rehearsal', now(), 'qr', 'required',
       'aaaaaaaa-0000-4000-8000-0000000000a1', 'd0000001-0000-4000-8000-000000000002', 'manual');
    v_state := 'INSERTED';
  exception
    when others then
      v_state := sqlstate;
  end;
  perform public.t_assert(v_state = 'INSERTED',
    format('ISO-11b alpha secretary could not insert into their own program (sqlstate %s)', v_state));
end $$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 9. Join-code gate is per program (called as the service/backend role)
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  -- ISO-12b — the CURRENT code opens the right program and nothing else.
  -- (An earlier block rotated Alpha's code from ALPHA9 to NEWCODE1, and the
  -- attempt to hijack Beta's code must have been refused — so these calls also
  -- prove the rotation landed in the right row.)
  v := public.validate_join_code('test-alpha', 'NEWCODE1', 'iso-test-ip');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-12b the current alpha join code was rejected: ' || coalesce(v ->> 'message', '?'));
  v := public.validate_join_code('test-alpha', 'ALPHA9', 'iso-test-ip');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-12b-ii the rotated-away alpha join code still opens alpha');
  v := public.validate_join_code('test-alpha', 'BETA9', 'iso-test-ip');
  perform public.t_assert(v ->> 'ok' = 'false',
    'ISO-12c Beta''s join code was accepted for Alpha');
  v := public.validate_join_code('test-beta', 'BETA9', 'iso-test-ip');
  perform public.t_assert(v ->> 'ok' = 'true',
    'ISO-12d beta join code rejected: ' || coalesce(v ->> 'message', '?'));

  -- ISO-12f — the two settings rows stayed independent.
  perform public.t_assert(
    (select join_code from public.ensemble_settings
      where ensemble_id = 'bbbbbbbb-0000-4000-8000-0000000000b1') = 'BETA9',
    'ISO-12f rotating the Alpha join code changed Beta''s');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Notification fan-out is the event's program only
-- ---------------------------------------------------------------------------
do $$
declare
  v_event uuid := 'e0000001-0000-4000-8000-0000000000e1';
begin
  perform set_config('app.suppress_event_notifications', 'false', true);

  insert into public.events
    (id, name, type, event_type, date, checkin_mode, attendance_requirement,
     ensemble_id, created_by, event_source)
  values
    (v_event, 'TST ISO notify probe', 'Rehearsal', 'rehearsal', now(), 'toggle', 'required',
     'aaaaaaaa-0000-4000-8000-0000000000a1', null, 'manual');

  -- ISO-14 — the event was seen by Alpha, and only by Alpha
  perform public.t_assert(
    exists (select 1 from public.notifications
             where type = 'new_event' and payload ->> 'event_id' = v_event::text),
    'ISO-14 no notifications were created for the Alpha event');
  -- NOTE: a persona who belongs to BOTH programs is a legitimate recipient of
  -- the Alpha notification, so this must test "is an active Alpha member", not
  -- "has no Beta membership".
  perform public.t_assert(
    not exists (
      select 1 from public.notifications n
       where n.type = 'new_event' and n.payload ->> 'event_id' = v_event::text
         and not exists (
           select 1 from public.memberships m
            where m.user_id = n.user_id
              and m.ensemble_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
              and m.active
         )
    ),
    'ISO-14 a non-Alpha persona was notified about an Alpha event');

  -- …and no one outside Alpha got one.
  perform public.t_assert(
    not exists (
      select 1 from public.notifications n
      where n.type = 'new_event' and n.payload ->> 'event_id' = v_event::text
        and n.user_id in (
          'd0000002-0000-4000-8000-000000000001',
          'd0000002-0000-4000-8000-000000000002',
          'd0000002-0000-4000-8000-000000000003',
          'd0000003-0000-4000-8000-000000000001'
        )
    ),
    'ISO-14 a non-Alpha persona was notified about an Alpha event');
end $$;

-- ---------------------------------------------------------------------------
-- 11. Teardown
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{}', true);
select set_config('app.suppress_event_notifications', 'false', true);

rollback;

select 'ENSEMBLE ISOLATION PASSED' as verification_result;
