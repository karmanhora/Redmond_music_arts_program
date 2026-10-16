-- ============================================================================
-- Security hardening suite — least-privilege grants (20261016225631)
-- ----------------------------------------------------------------------------
-- Runs inside one transaction and rolls back, so it leaves no fixtures behind.
-- Each assertion raises `FAIL: …` on violation; a clean run prints the notices.
--
--   SEC-H-1  a signed-in student cannot rebind their own profiles.auth_user_id
--   SEC-H-2  …nor rewrite profiles.id
--   SEC-H-3  …but can still edit their own bio (no feature regression)
--   SEC-H-4  a signed-in student cannot insert attendance rows directly
--   SEC-H-5  authenticated holds no TRUNCATE on attendance_records (RLS-bypass)
--   SEC-H-6  anon holds no table privileges on program data
-- ============================================================================
begin;

reset role;

insert into public.profiles (id, auth_user_id, full_name, display_name) values
  ('a0a0a0a0-0000-4000-8000-000000000001', 'auth-hard-student', 'Hard Student', 'Hard Student'),
  ('a0a0a0a0-0000-4000-8000-000000000002', 'auth-hard-victim', 'Hard Victim', 'Hard Victim');

-- ---------------------------------------------------------------------------
-- SEC-H-5, SEC-H-6 — catalog checks (no role switch needed)
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.attendance_records', 'TRUNCATE') then
    raise exception 'FAIL: SEC-H-5 authenticated can TRUNCATE attendance_records (bypasses RLS)';
  end if;
  if has_table_privilege('anon', 'public.profiles', 'SELECT')
     or has_table_privilege('anon', 'public.events', 'SELECT')
     or has_table_privilege('anon', 'public.attendance_records', 'SELECT') then
    raise exception 'FAIL: SEC-H-6 anon holds a table privilege on program data';
  end if;
  raise notice 'PASS SEC-H-5/6 catalog grants';
end $$;

-- ---------------------------------------------------------------------------
-- SEC-H-1..4 — act as the signed-in student
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
                  '{"sub":"auth-hard-student","role":"authenticated"}', true);

-- SEC-H-1: rebinding the login must be refused by the database, not the UI.
-- The target is a login NO profile holds, so the unique index cannot be the
-- thing that stops it: only the column privilege may.
do $$
begin
  update public.profiles
     set auth_user_id = 'auth-hard-unused-login'
   where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  raise exception 'FAIL: SEC-H-1 student rebound their own auth_user_id';
exception
  when insufficient_privilege then
    raise notice 'PASS SEC-H-1 auth_user_id is not self-writable';
end $$;

-- SEC-H-2: the primary key is not theirs to rewrite.
do $$
begin
  update public.profiles
     set id = 'a0a0a0a0-0000-4000-8000-0000000000ff'
   where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  raise exception 'FAIL: SEC-H-2 student rewrote their own profile id';
exception
  when insufficient_privilege then
    raise notice 'PASS SEC-H-2 profile id is not self-writable';
end $$;

-- SEC-H-3: the allowed edit still works and touches exactly one row.
do $$
declare v_rows int;
begin
  update public.profiles
     set bio = 'hardening check'
   where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL: SEC-H-3 own bio edit updated % rows, expected 1', v_rows;
  end if;
  raise notice 'PASS SEC-H-3 own bio remains editable';
end $$;

-- SEC-H-4: attendance is written only by definer RPCs, never by a direct insert.
do $$
begin
  insert into public.attendance_records (event_id, student_id, attended, status)
  values (gen_random_uuid(), 'a0a0a0a0-0000-4000-8000-000000000001', true, 'present');
  raise exception 'FAIL: SEC-H-4 student inserted an attendance row directly';
exception
  when insufficient_privilege then
    raise notice 'PASS SEC-H-4 attendance cannot be inserted directly';
end $$;

reset role;
rollback;
