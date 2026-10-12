-- ============================================================================
-- event_digest_emails.sql — the upcoming-events email digest is opt-out,
-- once-per-day, windowed, and never exposes addresses to a client
-- ============================================================================
-- requires-table: public.event_digest_deliveries
--
-- Asserts, in one transaction that is ROLLED BACK:
--   1. Who is owed an email: active + subscribed + confirmed address, and
--      nobody else — not an opted-out member, not an unconfirmed address, not a
--      deactivated account.
--   2. The window decides which events are announced: an event beyond it and an
--      archived event are left out, and a program with nothing upcoming produces
--      no row at all.
--   3. `record_event_digests()` is idempotent — a retried run inserts nothing and
--      the same people stop being due (one email per person per program per day).
--   4. A member can turn their own digest off and back on, and cannot write
--      anybody else's preference.
--   5. The recipient query, the recorder and the log are unreachable from a
--      client session — they carry email addresses.
--
-- On success: EVENT DIGEST EMAILS PASSED
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.due_event_digests(date, timestamptz, timestamptz, integer)') is null then
    raise exception 'FAIL: EDE-0 due_event_digests() missing — apply migration 032 first';
  end if;
  if to_regprocedure('public.record_event_digests(jsonb)') is null then
    raise exception 'FAIL: EDE-0 record_event_digests() missing — apply migration 032 first';
  end if;
  if to_regprocedure('public.set_email_upcoming_events(uuid, boolean)') is null then
    raise exception 'FAIL: EDE-0 set_email_upcoming_events() missing — apply migration 032 first';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'memberships'
       and column_name = 'email_upcoming_events'
  ) then
    raise exception 'FAIL: EDE-0 memberships.email_upcoming_events missing';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: three programs, six people, one of every exclusion reason
-- ---------------------------------------------------------------------------
insert into public.ensembles (id, slug, name)
values
  ('03200000-0000-4000-8000-000000000001', 'digest-a', 'Digest Program A'),
  ('03200000-0000-4000-8000-000000000002', 'digest-b', 'Digest Program B'),
  ('03200000-0000-4000-8000-000000000003', 'digest-quiet', 'Digest Program Quiet');

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('03200000-0000-4000-8000-000000000101', 'authenticated', 'authenticated',
   'digest-director@example.test', now(), now(), now()),
  ('03200000-0000-4000-8000-000000000102', 'authenticated', 'authenticated',
   'digest-student@example.test', now(), now(), now()),
  -- Never confirmed their address: we were never given permission to use it.
  ('03200000-0000-4000-8000-000000000103', 'authenticated', 'authenticated',
   'digest-unconfirmed@example.test', null, now(), now()),
  ('03200000-0000-4000-8000-000000000104', 'authenticated', 'authenticated',
   'digest-optout@example.test', now(), now(), now()),
  ('03200000-0000-4000-8000-000000000105', 'authenticated', 'authenticated',
   'digest-deactivated@example.test', now(), now(), now()),
  ('03200000-0000-4000-8000-000000000106', 'authenticated', 'authenticated',
   'digest-other@example.test', now(), now(), now()),
  ('03200000-0000-4000-8000-000000000107', 'authenticated', 'authenticated',
   'digest-quiet@example.test', now(), now(), now());

insert into public.profiles (id, auth_user_id, full_name, display_name, deactivated)
values
  ('03200000-0000-4000-8000-000000000201', '03200000-0000-4000-8000-000000000101', 'Digest Director', 'Dee Director', false),
  ('03200000-0000-4000-8000-000000000202', '03200000-0000-4000-8000-000000000102', 'Digest Student', '', false),
  ('03200000-0000-4000-8000-000000000203', '03200000-0000-4000-8000-000000000103', 'Digest Unconfirmed', '', false),
  ('03200000-0000-4000-8000-000000000204', '03200000-0000-4000-8000-000000000104', 'Digest Optout', '', false),
  ('03200000-0000-4000-8000-000000000205', '03200000-0000-4000-8000-000000000105', 'Digest Deactivated', '', true),
  ('03200000-0000-4000-8000-000000000206', '03200000-0000-4000-8000-000000000106', 'Digest Other', '', false),
  ('03200000-0000-4000-8000-000000000207', '03200000-0000-4000-8000-000000000107', 'Digest Quiet', '', false);

insert into public.memberships (user_id, ensemble_id, roles, email_upcoming_events)
values
  ('03200000-0000-4000-8000-000000000201', '03200000-0000-4000-8000-000000000001', '{director}', true),
  ('03200000-0000-4000-8000-000000000202', '03200000-0000-4000-8000-000000000001', '{student}', true),
  ('03200000-0000-4000-8000-000000000203', '03200000-0000-4000-8000-000000000001', '{student}', true),
  ('03200000-0000-4000-8000-000000000204', '03200000-0000-4000-8000-000000000001', '{student}', false),
  ('03200000-0000-4000-8000-000000000205', '03200000-0000-4000-8000-000000000001', '{student}', true),
  ('03200000-0000-4000-8000-000000000206', '03200000-0000-4000-8000-000000000002', '{student}', true),
  ('03200000-0000-4000-8000-000000000207', '03200000-0000-4000-8000-000000000003', '{student}', true);

insert into public.events (name, type, date, ensemble_id, event_type, archived)
values
  ('A In Window',   'Rehearsal', now() + interval '2 days',  '03200000-0000-4000-8000-000000000001', 'rehearsal', false),
  ('A Out Of Window','Concert',  now() + interval '30 days', '03200000-0000-4000-8000-000000000001', 'concert',   false),
  ('A Archived',    'Rehearsal', now() + interval '3 days',  '03200000-0000-4000-8000-000000000001', 'rehearsal', true),
  ('B In Window',   'Rehearsal', now() + interval '1 day',   '03200000-0000-4000-8000-000000000002', 'rehearsal', false);

-- ---------------------------------------------------------------------------
-- 1. Who is owed an email
-- ---------------------------------------------------------------------------
do $$
declare
  v_a int;
  v_b int;
  v_names text;
begin
  select count(*) into v_a
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000001';
  if v_a <> 2 then
    raise exception 'FAIL: EDE-1 program A owes % emails, expected 2 (director + student)', v_a;
  end if;

  select string_agg(d.email, ',' order by d.email) into v_names
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000001';
  if v_names <> 'digest-director@example.test,digest-student@example.test' then
    raise exception 'FAIL: EDE-1 wrong recipients for program A: %', v_names;
  end if;

  -- The opted-out member, the unconfirmed address and the deactivated account
  -- all stay quiet.
  if v_names like '%optout%' or v_names like '%unconfirmed%' or v_names like '%deactivated%' then
    raise exception 'FAIL: EDE-1 an excluded member was owed an email: %', v_names;
  end if;

  -- A different program with its own event is owed its own email.
  select count(*) into v_b
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000002';
  if v_b <> 1 then
    raise exception 'FAIL: EDE-1 program B owes % emails, expected 1', v_b;
  end if;

  -- The quiet program has no upcoming events, so it produces nothing at all.
  if exists (
    select 1 from public.due_event_digests(current_date, now(), now() + interval '7 days') d
     where d.ensemble_id = '03200000-0000-4000-8000-000000000003'
  ) then
    raise exception 'FAIL: EDE-1 a program with no upcoming events produced a digest';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The window decides which events are announced
-- ---------------------------------------------------------------------------
do $$
declare
  v_row record;
begin
  select d.event_count, d.events into v_row
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.email = 'digest-director@example.test';

  if v_row.event_count <> 1 then
    raise exception 'FAIL: EDE-2 a 7-day window announced % events, expected 1', v_row.event_count;
  end if;
  if (v_row.events -> 0 ->> 'name') <> 'A In Window' then
    raise exception 'FAIL: EDE-2 wrong event in the 7-day window: %', v_row.events;
  end if;
  if v_row.events::text like '%A Archived%' then
    raise exception 'FAIL: EDE-2 an archived event was announced';
  end if;
  -- The event carries what the email needs to render it.
  if (v_row.events -> 0 ->> 'event_type') <> 'rehearsal'
     or (v_row.events -> 0 -> 'date') is null then
    raise exception 'FAIL: EDE-2 the announced event is missing its type or date: %', v_row.events;
  end if;

  -- Widening the window picks up the later event and still skips the archived one.
  select d.event_count, d.events into v_row
    from public.due_event_digests(current_date, now(), now() + interval '60 days') d
   where d.email = 'digest-director@example.test';
  if v_row.event_count <> 2 then
    raise exception 'FAIL: EDE-2 a 60-day window announced % events, expected 2', v_row.event_count;
  end if;
  if (v_row.events -> 1 ->> 'name') <> 'A Out Of Window' then
    raise exception 'FAIL: EDE-2 the window is not ordered by date: %', v_row.events;
  end if;
  if v_row.events::text like '%A Archived%' then
    raise exception 'FAIL: EDE-2 an archived event was announced in the wider window';
  end if;

  -- A window that has already passed owes nobody anything.
  if exists (
    select 1 from public.due_event_digests(current_date, now() - interval '30 days', now() - interval '20 days') d
     where d.ensemble_id = '03200000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: EDE-2 a past window produced a digest';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. One email per person per program per day
-- ---------------------------------------------------------------------------
do $$
declare
  v_first  int;
  v_second int;
  v_batch  jsonb;
  v_due    int;
begin
  select jsonb_agg(
           jsonb_build_object(
             'user_id', d.user_id,
             'ensemble_id', d.ensemble_id,
             'digest_date', current_date,
             'event_ids', (select jsonb_agg(e ->> 'id') from jsonb_array_elements(d.events) e)
           )
         )
    into v_batch
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000001';

  v_first := public.record_event_digests(v_batch);
  if v_first <> 2 then
    raise exception 'FAIL: EDE-3 the first run recorded % deliveries, expected 2', v_first;
  end if;

  -- A retried run is a no-op: the same people are no longer due, and nothing
  -- new is written.
  select count(*) into v_due
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000001';
  if v_due <> 0 then
    raise exception 'FAIL: EDE-3 % people are still due after a successful run', v_due;
  end if;
  v_second := public.record_event_digests(v_batch);
  if v_second <> 0 then
    raise exception 'FAIL: EDE-3 a retried run recorded % duplicate deliveries', v_second;
  end if;

  -- What the run announced is kept on the delivery row.
  if not exists (
    select 1 from public.event_digest_deliveries
     where user_id = '03200000-0000-4000-8000-000000000201'
       and ensemble_id = '03200000-0000-4000-8000-000000000001'
       and digest_date = current_date
       and array_length(event_ids, 1) = 1
  ) then
    raise exception 'FAIL: EDE-3 the delivery row did not keep the announced event ids';
  end if;

  -- Tomorrow is a new day: the same people are due again.
  select count(*) into v_due
    from public.due_event_digests(current_date + 1, now(), now() + interval '7 days') d
   where d.ensemble_id = '03200000-0000-4000-8000-000000000001';
  if v_due <> 2 then
    raise exception 'FAIL: EDE-3 the next day owes % emails, expected 2', v_due;
  end if;

  -- A malformed payload is refused rather than silently ignored.
  begin
    perform public.record_event_digests('{"not":"an array"}'::jsonb);
    raise exception 'FAIL: EDE-3 a non-array payload was accepted';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. A member controls only their own preference
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_before text;
  v_after  text;
begin
  -- The opted-out member (which is why they were never due) turns it back on
  -- as themselves, from a client session.
  perform set_config('request.jwt.claims',
    '{"sub":"03200000-0000-4000-8000-000000000104","role":"authenticated"}', true);
  set local role authenticated;
  v_result := public.set_email_upcoming_events('03200000-0000-4000-8000-000000000001', true);
  reset role;

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: EDE-4 a member could not subscribe to their own program: %', v_result;
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = '03200000-0000-4000-8000-000000000204'
       and ensemble_id = '03200000-0000-4000-8000-000000000001'
       and email_upcoming_events
  ) then
    raise exception 'FAIL: EDE-4 the preference was not written';
  end if;

  -- And back off again.
  perform set_config('request.jwt.claims',
    '{"sub":"03200000-0000-4000-8000-000000000104","role":"authenticated"}', true);
  v_result := public.set_email_upcoming_events('03200000-0000-4000-8000-000000000001', false);
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: EDE-4 a member could not unsubscribe: %', v_result;
  end if;

  -- A member of another program cannot touch this program's members, and is
  -- told so rather than being silently ignored. Every flag in program A is
  -- compared across the call: a scoping bug would have to move someone.
  select string_agg(user_id::text || ':' || email_upcoming_events::text, ',' order by user_id)
    into v_before
    from public.memberships
   where ensemble_id = '03200000-0000-4000-8000-000000000001';

  perform set_config('request.jwt.claims',
    '{"sub":"03200000-0000-4000-8000-000000000106","role":"authenticated"}', true);
  v_result := public.set_email_upcoming_events('03200000-0000-4000-8000-000000000001', true);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: EDE-4 an outsider changed another program''s preference: %', v_result;
  end if;

  select string_agg(user_id::text || ':' || email_upcoming_events::text, ',' order by user_id)
    into v_after
    from public.memberships
   where ensemble_id = '03200000-0000-4000-8000-000000000001';
  if v_after is distinct from v_before then
    raise exception 'FAIL: EDE-4 the outsider''s call changed a preference (before %, after %)',
      v_before, v_after;
  end if;
  if exists (
    select 1 from public.memberships
     where user_id = '03200000-0000-4000-8000-000000000206'
       and ensemble_id = '03200000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: EDE-4 the outsider was enrolled in a program they are not in';
  end if;

  -- Signed out: no profile, no write.
  perform set_config('request.jwt.claims', '{}', true);
  v_result := public.set_email_upcoming_events('03200000-0000-4000-8000-000000000001', true);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: EDE-4 an anonymous caller changed a preference: %', v_result;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Addresses never reach a client
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean;
begin
  if has_table_privilege('authenticated', 'public.event_digest_deliveries', 'SELECT')
     or has_table_privilege('anon', 'public.event_digest_deliveries', 'SELECT') then
    raise exception 'FAIL: EDE-5 a client role can read the delivery log';
  end if;
  if has_function_privilege('authenticated',
       'public.due_event_digests(date, timestamptz, timestamptz, integer)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.due_event_digests(date, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL: EDE-5 a client role can execute due_event_digests()';
  end if;
  if has_function_privilege('authenticated', 'public.record_event_digests(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_event_digests(jsonb)', 'EXECUTE') then
    raise exception 'FAIL: EDE-5 a client role can execute record_event_digests()';
  end if;
  if has_function_privilege('anon',
       'public.set_email_upcoming_events(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: EDE-5 anon can execute set_email_upcoming_events()';
  end if;

  -- Even as the director of the program, a client session cannot read the log.
  perform set_config('request.jwt.claims',
    '{"sub":"03200000-0000-4000-8000-000000000101","role":"authenticated"}', true);
  set local role authenticated;
  begin
    perform count(*) from public.event_digest_deliveries;
    v_blocked := false;
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;
  reset role;
  if not v_blocked then
    raise exception 'FAIL: EDE-5 a director read the delivery log from a client session';
  end if;

  raise notice 'event digest emails OK: opt-out, windowed, once per day, addresses server-side only';
end
$$;

rollback;

\echo 'EVENT DIGEST EMAILS PASSED'
