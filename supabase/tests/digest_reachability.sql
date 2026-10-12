-- ============================================================================
-- digest_reachability.sql — a director can see who the weekly email reaches,
-- and why it does not reach the rest
-- ============================================================================
-- requires-table: public.event_digest_deliveries
--
-- Asserts, in one transaction that is ROLLED BACK:
--   1. Every active member is accounted for exactly once, with the reason the
--      digest would skip them: opted out, no account, no address, unconfirmed,
--      deactivated — and the rest are reachable. A member who has been removed
--      from the roster is not in the report at all.
--   2. `reachable` is the same number `due_event_digests()` (032) would mail,
--      and a program with no upcoming events is reported as reachable-but-quiet
--      rather than as unreachable.
--   3. The window is the caller's, clamped to 1–30 days, and it decides the
--      event count.
--   4. Only staff of that program may ask. A student of it, a member of another
--      program, and a signed-out caller are all refused with a message.
--   5. The report names no addresses and carries no email text.
--
-- On success: DIGEST REACHABILITY PASSED
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.digest_reachability(uuid, integer)') is null then
    raise exception 'FAIL: DR-0 digest_reachability() missing — apply migration 033 first';
  end if;
  if to_regprocedure('public.due_event_digests(date, timestamptz, timestamptz, integer)') is null then
    raise exception 'FAIL: DR-0 due_event_digests() missing — apply migration 032 first';
  end if;
  if has_function_privilege('anon', 'public.digest_reachability(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: DR-0 anon can execute digest_reachability()';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: three programs, one persona per reason
-- ---------------------------------------------------------------------------
insert into public.ensembles (id, slug, name, active)
values
  ('03300000-0000-4000-8000-000000000001', 'reach-a', 'Reach Program A', true),
  ('03300000-0000-4000-8000-000000000002', 'reach-b', 'Reach Program B (archived)', false),
  ('03300000-0000-4000-8000-000000000003', 'reach-quiet', 'Reach Program Quiet', true);

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('03300000-0000-4000-8000-000000000101', 'authenticated', 'authenticated',
   'reach-director@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-000000000102', 'authenticated', 'authenticated',
   'reach-unconfirmed@example.test', null, now(), now()),
  -- No account at all: the profile carries no auth_user_id (a restored or
  -- invited roster row nobody has signed in for).
  ('03300000-0000-4000-8000-000000000104', 'authenticated', 'authenticated',
   'reach-optout@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-000000000105', 'authenticated', 'authenticated',
   'reach-deactivated@example.test', now(), now(), now()),
  -- An account with no address on it.
  ('03300000-0000-4000-8000-000000000106', 'authenticated', 'authenticated',
   null, now(), now(), now()),
  ('03300000-0000-4000-8000-000000000107', 'authenticated', 'authenticated',
   'reach-removed@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-000000000108', 'authenticated', 'authenticated',
   'reach-student@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-000000000109', 'authenticated', 'authenticated',
   'reach-b@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-00000000010a', 'authenticated', 'authenticated',
   'reach-quiet@example.test', now(), now(), now()),
  ('03300000-0000-4000-8000-00000000010b', 'authenticated', 'authenticated',
   'reach-admin@example.test', now(), now(), now());

insert into public.profiles (id, auth_user_id, full_name, display_name, deactivated)
values
  ('03300000-0000-4000-8000-000000000201', '03300000-0000-4000-8000-000000000101', 'Reach Director', 'Reach Director', false),
  ('03300000-0000-4000-8000-000000000202', '03300000-0000-4000-8000-000000000102', 'Reach Unconfirmed', '', false),
  -- Never signed in: no `auth_user_id` at all.
  ('03300000-0000-4000-8000-000000000203', null, 'Reach No Account', '', false),
  ('03300000-0000-4000-8000-000000000204', '03300000-0000-4000-8000-000000000104', 'Reach Optout', '', false),
  ('03300000-0000-4000-8000-000000000205', '03300000-0000-4000-8000-000000000105', 'Reach Deactivated', '', true),
  ('03300000-0000-4000-8000-000000000206', '03300000-0000-4000-8000-000000000106', 'Reach No Address', '', false),
  ('03300000-0000-4000-8000-000000000207', '03300000-0000-4000-8000-000000000107', 'Reach Removed', '', false),
  ('03300000-0000-4000-8000-000000000208', '03300000-0000-4000-8000-000000000108', 'Reach Student', '', false),
  ('03300000-0000-4000-8000-000000000209', '03300000-0000-4000-8000-000000000109', 'Reach Other Program', '', false),
  ('03300000-0000-4000-8000-00000000020a', '03300000-0000-4000-8000-00000000010a', 'Reach Quiet Member', '', false),
  -- A program-level admin: staff of every program (013), and the only caller who
  -- reaches the "that program does not exist" answer.
  ('03300000-0000-4000-8000-000000000211', '03300000-0000-4000-8000-00000000010b', 'Reach Admin', '', false);

insert into public.memberships (user_id, ensemble_id, roles, active, email_upcoming_events)
values
  ('03300000-0000-4000-8000-000000000201', '03300000-0000-4000-8000-000000000001', '{director}',  true,  true),
  ('03300000-0000-4000-8000-000000000202', '03300000-0000-4000-8000-000000000001', '{student}',   true,  true),
  ('03300000-0000-4000-8000-000000000203', '03300000-0000-4000-8000-000000000001', '{student}',   true,  true),
  ('03300000-0000-4000-8000-000000000204', '03300000-0000-4000-8000-000000000001', '{student}',   true,  false),
  ('03300000-0000-4000-8000-000000000205', '03300000-0000-4000-8000-000000000001', '{student}',   true,  true),
  ('03300000-0000-4000-8000-000000000206', '03300000-0000-4000-8000-000000000001', '{student}',   true,  true),
  -- Removed from the roster: not a member any more, so not part of the report.
  ('03300000-0000-4000-8000-000000000207', '03300000-0000-4000-8000-000000000001', '{student}',   false, true),
  ('03300000-0000-4000-8000-000000000208', '03300000-0000-4000-8000-000000000001', '{student}',   true,  true),
  ('03300000-0000-4000-8000-000000000209', '03300000-0000-4000-8000-000000000002', '{director}',  true,  true),
  ('03300000-0000-4000-8000-00000000020a', '03300000-0000-4000-8000-000000000003', '{director}',  true,  true);

insert into public.program_admins (user_id)
values ('03300000-0000-4000-8000-000000000211');

insert into public.events (name, type, date, ensemble_id, event_type, archived)
values
  ('A Soon',      'Rehearsal', now() + interval '2 days',  '03300000-0000-4000-8000-000000000001', 'rehearsal', false),
  ('A Far',       'Concert',   now() + interval '20 days', '03300000-0000-4000-8000-000000000001', 'concert',   false),
  ('A Archived',  'Rehearsal', now() + interval '2 days',  '03300000-0000-4000-8000-000000000001', 'rehearsal', true),
  ('B Soon',      'Rehearsal', now() + interval '1 day',   '03300000-0000-4000-8000-000000000002', 'rehearsal', false);

-- ---------------------------------------------------------------------------
-- 1. Who is reachable, and why the rest are not
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_row    record;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000101","role":"authenticated"}', true);

  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: DR-1 a director could not read the report: %', v_result;
  end if;

  -- Seven active members; the removed one is not among them.
  if (v_result ->> 'members')::int <> 7 then
    raise exception 'FAIL: DR-1 members = %, expected 7 active', v_result ->> 'members';
  end if;
  if (v_result ->> 'reachable')::int <> 2 then
    raise exception 'FAIL: DR-1 reachable = %, expected 2 (director + student)',
      v_result ->> 'reachable';
  end if;

  -- Every active member appears exactly once, and nobody else does.
  if jsonb_array_length(v_result -> 'people') <> 7 then
    raise exception 'FAIL: DR-1 the report lists % people, expected 7',
      jsonb_array_length(v_result -> 'people');
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_result -> 'people') p
     where p ->> 'user_id' = '03300000-0000-4000-8000-000000000207'
  ) then
    raise exception 'FAIL: DR-1 a member removed from the roster is in the report';
  end if;
  if (
    select count(distinct p ->> 'user_id')
      from jsonb_array_elements(v_result -> 'people') p
  ) <> 7 then
    raise exception 'FAIL: DR-1 the report repeats or drops a member';
  end if;

  -- Each persona carries the reason the digest would skip them.
  for v_row in
    select expected.user_id, expected.status
      from (values
        ('03300000-0000-4000-8000-000000000201', 'reachable'),
        ('03300000-0000-4000-8000-000000000202', 'unconfirmed'),
        ('03300000-0000-4000-8000-000000000203', 'no_sign_in'),
        ('03300000-0000-4000-8000-000000000204', 'opted_out'),
        ('03300000-0000-4000-8000-000000000205', 'account_deactivated'),
        ('03300000-0000-4000-8000-000000000206', 'no_address'),
        ('03300000-0000-4000-8000-000000000208', 'reachable')
      ) as expected(user_id, status)
  loop
    if not exists (
      select 1
        from jsonb_array_elements(v_result -> 'people') p
       where p ->> 'user_id' = v_row.user_id
         and p ->> 'status'  = v_row.status
    ) then
      raise exception 'FAIL: DR-1 % was reported as %, expected %',
        v_row.user_id, coalesce((
          select p ->> 'status' from jsonb_array_elements(v_result -> 'people') p
           where p ->> 'user_id' = v_row.user_id
        ), 'nothing'), v_row.status;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. `reachable` is what the digest would actually mail
-- ---------------------------------------------------------------------------
do $$
declare
  v_result   jsonb;
  v_director jsonb;
  v_due      int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000101","role":"authenticated"}', true);
  v_director := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);

  -- The same window the cron job asks for: every reachable person is due, so the
  -- count on the card and the recipient list can never disagree.
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  select count(*) into v_due
    from public.due_event_digests(current_date, now(), now() + interval '7 days') d
   where d.ensemble_id = '03300000-0000-4000-8000-000000000001';
  if v_due <> (v_result ->> 'reachable')::int then
    raise exception 'FAIL: DR-2 the report says % reachable but the digest owes %',
      v_result ->> 'reachable', v_due;
  end if;
  if v_due <> 2 then
    raise exception 'FAIL: DR-2 the digest owes % emails, expected 2', v_due;
  end if;

  -- A quiet program: everyone is reachable, nobody is owed anything this week.
  -- "Reachable" and "will get an email" are different questions. Its own
  -- director has to ask — staff authority stops at the program.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-00000000010a","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000003', 7);
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: DR-2 the quiet program''s own director was refused: %', v_result;
  end if;
  if (v_result ->> 'reachable')::int <> 1 or (v_result ->> 'events')::int <> 0 then
    raise exception 'FAIL: DR-2 a program with no upcoming events reported % reachable and % events',
      v_result ->> 'reachable', v_result ->> 'events';
  end if;
  if (v_result ->> 'program_active')::boolean is not true then
    raise exception 'FAIL: DR-2 an active program was reported as archived: %', v_result;
  end if;

  -- An archived program says so, rather than looking like an empty roster.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000109","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000002', 7);
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: DR-2 the archived program''s own director was refused: %', v_result;
  end if;
  if (v_result ->> 'program_active')::boolean is not false
     or (v_result ->> 'members')::int <> 1
     or (v_result ->> 'events')::int <> 1 then
    raise exception 'FAIL: DR-2 the archived program was reported wrongly: %', v_result;
  end if;

  -- A program admin is staff of every program, and sees exactly what its own
  -- director sees: one report, two callers.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-00000000010b","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: DR-2 a program admin was refused: %', v_result;
  end if;
  if v_result is distinct from v_director then
    raise exception 'FAIL: DR-2 the admin and the director read different reports (% vs %)',
      v_result, v_director;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. The window belongs to the caller, clamped
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000101","role":"authenticated"}', true);

  -- One day: the event two days out is outside it, so nothing is announced and
  -- the reachability of the people is unchanged.
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 1);
  if (v_result ->> 'events')::int <> 0
     or (v_result ->> 'reachable')::int <> 2
     or (v_result ->> 'window_days')::int <> 1 then
    raise exception 'FAIL: DR-3 a 1-day window reported % events, % reachable, % days: %',
      v_result ->> 'events', v_result ->> 'reachable', v_result ->> 'window_days', v_result;
  end if;

  -- The window is half-open — `[now, now + days)` — the same rule the sender
  -- uses, so an event landing exactly on the boundary belongs to the next
  -- window. "A Far" sits exactly 20 days out: out at 20, in at 21. (One
  -- transaction, so `now()` is the same instant for the fixtures and the call.)
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 20);
  if (v_result ->> 'events')::int <> 1 then
    raise exception 'FAIL: DR-3 a 20-day window reported % events, expected 1 (the boundary event is outside)',
      v_result ->> 'events';
  end if;
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 21);
  if (v_result ->> 'events')::int <> 2 then
    raise exception 'FAIL: DR-3 a 21-day window reported % events, expected 2',
      v_result ->> 'events';
  end if;
  -- Two, not three: the archived event sits in that same window and is still
  -- not counted, which is the only way this number can be 2.

  -- An absurd or absent window is clamped, not obeyed.
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 9999);
  if (v_result ->> 'window_days')::int <> 30 then
    raise exception 'FAIL: DR-3 a 9999-day window was not clamped: %', v_result ->> 'window_days';
  end if;
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', -5);
  if (v_result ->> 'window_days')::int <> 1 then
    raise exception 'FAIL: DR-3 a negative window was not clamped: %', v_result ->> 'window_days';
  end if;
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001');
  if (v_result ->> 'window_days')::int <> 7 then
    raise exception 'FAIL: DR-3 the default window is not 7 days: %', v_result ->> 'window_days';
  end if;

  -- A program that does not exist is answered, not crashed on — and saying which
  -- it is, rather than reporting an empty roster. Only a program-level admin can
  -- tell the two apart, because everyone else is refused before the lookup.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-00000000010b","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-0000000000ff', 7);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: DR-3 an unknown program produced a report: %', v_result;
  end if;
  if coalesce(v_result ->> 'message', '') not like '%does not exist%' then
    raise exception 'FAIL: DR-3 an unknown program was not named as unknown: %', v_result;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Only staff of that program may ask
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  -- A student of the same program: refused, with a message rather than silence.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000108","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: DR-4 a student read the reachability report: %', v_result;
  end if;
  if coalesce(v_result ->> 'message', '') = '' then
    raise exception 'FAIL: DR-4 the refusal carried no message';
  end if;
  if v_result::text like '%reachable%' then
    raise exception 'FAIL: DR-4 the refusal leaked the report: %', v_result;
  end if;

  -- A director of a *different* program: refused, and nothing about the roster
  -- crosses over.
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000109","role":"authenticated"}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: DR-4 another program''s director read this program: %', v_result;
  end if;
  if v_result::text like '%03300000-0000-4000-8000-0000000002%' then
    raise exception 'FAIL: DR-4 the refusal named this program''s members: %', v_result;
  end if;

  -- Signed out: no profile, no report.
  perform set_config('request.jwt.claims', '{}', true);
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: DR-4 an anonymous caller read the report: %', v_result;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. No address ever crosses the boundary
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"03300000-0000-4000-8000-000000000101","role":"authenticated"}', true);

  -- Called the way a client calls it, from a client role.
  set local role authenticated;
  v_result := public.digest_reachability('03300000-0000-4000-8000-000000000001', 7);
  reset role;

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: DR-5 a client session could not call the report: %', v_result;
  end if;
  -- The whole payload, searched: an address would have to contain an @.
  if v_result::text like '%@%' then
    raise exception 'FAIL: DR-5 the report carried email text: %', v_result;
  end if;
  if v_result::text like '%reach-%' then
    raise exception 'FAIL: DR-5 the report carried an address local part: %', v_result;
  end if;

  raise notice 'digest reachability OK: every member labelled, reachable matches the digest, staff only, no addresses';
end
$$;

rollback;

\echo 'DIGEST REACHABILITY PASSED'
