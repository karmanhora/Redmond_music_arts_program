-- ============================================================================
-- create_program.sql — starting your own program, with no director involved
-- ============================================================================
-- requires-table: public.ensembles
--
-- Covers `create_program()` (migration 022): a teacher signs up, names a
-- program, and is its director — nobody has to add them to anything. That is
-- only safe if the call cannot be aimed at a program that already exists, so
-- most of what follows is about what the new director does NOT get.
--
--   CP-1   a caller with no account id is refused, and creates nothing
--   CP-2   a blank or one-character name is refused, and creates nothing
--   CP-3   the first call creates the person, the program and their director
--          membership, and records them as the creator
--   CP-4   the new program arrives CLOSED — it carries a join code, the join
--          screen says so, and only that code opens it
--   CP-5   the slug comes from the name, and a second program with the same
--          name gets its own; two programs are still one person
--   CP-6   THE SECURITY CLAIM: director of the program they made, and of
--          nothing else — the band stays invisible and untouchable to them
--   CP-7   five programs an hour, then the sixth call is refused
--   CP-8   anon cannot call it at all, and its signature has no argument that
--          could point it at another program
--   CP-9   a paused account is refused
--
-- Runs in one transaction and ROLLS BACK. Personas authenticate exactly the way
-- PostgREST sees a Supabase Auth token (migration 021). On success it prints:
-- CREATE PROGRAM PASSED
--
-- A note on reading the aftermath: a brand-new program is invisible to everyone
-- except its director, and a persona who only just got a `profiles` row sees
-- almost nothing through RLS. So every "was something created?" question is
-- asked AFTER `reset role`, as the owner. Asked from inside the persona, those
-- questions answer themselves — an empty result would look like proof.
--
-- A note on validate_join_code: it is deliberately NOT callable by
-- `authenticated` (016 grants it to service_role only), so the gate itself is
-- exercised as the owner below, and its effect on a real person is exercised
-- through `join_program()`.
-- ============================================================================

begin;

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

-- Persona blocks below run with `role = authenticated`, so they must be able to
-- call it. (The "anon can execute nothing" sweeps exclude this test artefact by
-- name — it is not part of the app's surface.)
grant execute on function public.t_assert(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 0b. Prerequisites — fail fast, and name the migration that is missing
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.create_program(text, text, text, text)') is null then
    raise exception 'FAIL: CP-0 public.create_program() missing — apply migration 022 first';
  end if;
  if to_regprocedure('public.generate_join_code(int)') is null then
    raise exception 'FAIL: CP-0 public.generate_join_code() missing — apply migration 022 first';
  end if;
  if to_regprocedure('public.join_program(text, text, text, text)') is null then
    raise exception 'FAIL: CP-0 public.join_program() missing — apply migration 020 first';
  end if;
  if not exists (select 1 from public.ensembles where slug = 'band') then
    raise exception 'FAIL: CP-0 the band program is missing — apply migration 014 first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures (as the owner, rolled back at the end)
-- ---------------------------------------------------------------------------
-- Two people: one already on the band roster (the person a new director must
-- not be able to touch), and one account that has been paused.
insert into public.profiles (id, auth_user_id, full_name, display_name) values
  ('dddddddd-0000-4000-8000-0000000000d1', 'cp-band-student', 'CP Band Student', 'CP Band Student'),
  ('dddddddd-0000-4000-8000-0000000000d2', 'cp-paused',       'CP Paused',       'CP Paused')
on conflict (id) do nothing;

insert into public.memberships (user_id, ensemble_id, roles, active)
select 'dddddddd-0000-4000-8000-0000000000d1'::uuid, b.id, '{student}'::public.app_role[], true
  from public.ensembles b
 where b.slug = 'band'
on conflict (user_id, ensemble_id) do nothing;

update public.profiles set deactivated = true where auth_user_id = 'cp-paused';

-- ---------------------------------------------------------------------------
-- 2. CP-1 — a caller with no account id
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_ens_before int;
  v_prof_before int;
  v_ens_after int;
  v_prof_after int;
begin
  select count(*) into v_ens_before from public.ensembles;
  select count(*) into v_prof_before from public.profiles;

  -- Signed in to nothing at all: no `sub` claim. This is the "nobody at all"
  -- case, and it must not mint a program (or a person).
  perform set_config('request.jwt.claims', '{}', true);
  set role authenticated;

  v := public.create_program('CP Nobody', null, 'Nobody');
  reset role;

  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-1 a caller with no account id was allowed to start a program');
  perform public.t_assert(coalesce(v ->> 'message', '') <> '',
    'CP-1b the refusal came with no message to show the person');

  select count(*) into v_ens_after from public.ensembles;
  select count(*) into v_prof_after from public.profiles;
  perform public.t_assert(v_ens_after = v_ens_before,
    'CP-1c a token-less call created a program');
  perform public.t_assert(v_prof_after = v_prof_before,
    'CP-1d a token-less call created a person');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 3. CP-2 — a name that is not a name
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_ens_before int;
  v_ens_after int;
begin
  select count(*) into v_ens_before from public.ensembles;

  perform set_config('request.jwt.claims', '{"sub":"cp-namer","role":"authenticated"}', true);
  set role authenticated;

  v := public.create_program('   ', null, 'Blank Name');
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-2 a whitespace-only program name was accepted');

  v := public.create_program('', null, 'Empty Name');
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-2b an empty program name was accepted');

  v := public.create_program('x', null, 'One Character');
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-2c a one-character program name was accepted');
  reset role;

  select count(*) into v_ens_after from public.ensembles;
  perform public.t_assert(v_ens_after = v_ens_before,
    'CP-2d a refused name still created a program');

  -- The refusal happens before the person is created, so a typo in the name
  -- field cannot leave a half-made account behind.
  perform public.t_assert(
    not exists (select 1 from public.profiles where auth_user_id = 'cp-namer'),
    'CP-2e a refused name still created the person');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 4. CP-3 — the first program
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_prog uuid;
  v_profile uuid;
  v_code text;
begin
  perform set_config('request.jwt.claims', '{"sub":"cp-starter","role":"authenticated"}', true);
  set role authenticated;

  v := public.create_program('TST Starter Band', 'Starter', 'Starter Teacher');
  reset role;

  perform public.t_assert(v ->> 'ok' = 'true',
    'CP-3 a signed-in person could not start a program: ' || coalesce(v ->> 'message', '?'));
  perform public.t_assert(coalesce(v ->> 'slug', '') = 'tst-starter-band',
    'CP-3b the slug was not derived from the name: ' || coalesce(v ->> 'slug', '?'));
  perform public.t_assert(coalesce(v ->> 'name', '') = 'TST Starter Band',
    'CP-3c the response did not name the program it made');

  v_prog := (v ->> 'program_id')::uuid;
  select id into v_profile from public.profiles where auth_user_id = 'cp-starter';

  perform public.t_assert(v_profile is not null,
    'CP-3d starting a program did not create the person');
  perform public.t_assert((v ->> 'profile_id')::uuid = v_profile,
    'CP-3e the response named a profile other than the one it created');

  -- The whole point: they own it, and they are on its roster as its director.
  perform public.t_assert(
    (select count(*) from public.memberships
      where user_id = v_profile
        and ensemble_id = v_prog
        and active
        and roles = '{director}'::public.app_role[]) = 1,
    'CP-3f the creator is not an active director of the program they made');

  -- …and the ledger says who made it.
  perform public.t_assert(
    (select created_by from public.ensembles where id = v_prog) = v_profile,
    'CP-3g ensembles.created_by does not name the creator');

  perform public.t_assert(
    (select short_name from public.ensembles where id = v_prog) = 'Starter',
    'CP-3h the short name was not stored');

  -- The response must hand the director the code that is actually on the row:
  -- if these two ever disagree, the code they write on the whiteboard is wrong.
  select join_code into v_code from public.ensemble_settings where ensemble_id = v_prog;
  perform public.t_assert(coalesce(v_code, '') <> '' and v_code = (v ->> 'join_code'),
    'CP-3i the response did not carry the join code that is stored');

  perform public.t_assert(
    exists (select 1 from public.memberships
             where id = (v ->> 'membership_id')::uuid
               and user_id = v_profile
               and ensemble_id = v_prog),
    'CP-3j the response named a membership that does not exist');

  perform public.t_assert(
    (select full_name from public.profiles where id = v_profile) = 'Starter Teacher',
    'CP-3k the supplied name was not stored on the person');

  -- A 200-character name is capped, not stored raw (it is shown on the roster).
  perform set_config('request.jwt.claims', '{"sub":"cp-longname","role":"authenticated"}', true);
  set role authenticated;
  v := public.create_program('TST Long Name', null, repeat('n', 200));
  reset role;

  perform public.t_assert(v ->> 'ok' = 'true',
    'CP-3l a long person name stopped the program being made: ' || coalesce(v ->> 'message', '?'));

  perform public.t_assert(
    (select length(full_name) from public.profiles where auth_user_id = 'cp-longname') <= 80,
    'CP-3m a 200-character name was stored uncapped');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 5. CP-4 — a new program is closed until its director shares the code
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_row jsonb;
  v_prog uuid;
  v_slug text;
  v_code text;
  v_gate jsonb;
begin
  select e.id, e.slug, s.join_code
    into v_prog, v_slug, v_code
    from public.ensembles e
    left join public.ensemble_settings s on s.ensemble_id = e.id
   where e.slug = 'tst-starter-band';

  perform public.t_assert(v_prog is not null,
    'CP-4 the program CP-3 created is not in ensembles');
  perform public.t_assert(coalesce(v_code, '') <> '',
    'CP-4b a new program was left with no join code — an empty code means "no code required" (016), so anybody who guessed the slug could walk in');

  -- The gate itself, as the owner: it is not callable by `authenticated`.
  v_gate := public.validate_join_code(v_slug, 'WRONG123', 'cp-ip-gate');
  perform public.t_assert(v_gate ->> 'ok' = 'false',
    'CP-4c a wrong code was accepted by a new program''s gate');

  v_gate := public.validate_join_code(v_slug, v_code, 'cp-ip-gate');
  perform public.t_assert(v_gate ->> 'ok' = 'true',
    'CP-4d the code the creator was handed was refused by the gate');

  -- The join screen has to advertise it as needing one.
  perform set_config('request.jwt.claims', '{"sub":"cp-stranger","role":"authenticated"}', true);
  set role authenticated;
  v := public.list_active_programs();
  reset role;

  select x into v_row from jsonb_array_elements(v) x where x ->> 'slug' = v_slug;
  perform public.t_assert(v_row is not null,
    'CP-4e a program nobody could find is a program nobody can join');
  perform public.t_assert(v_row ->> 'has_join_code' = 'true',
    'CP-4f the new program was advertised as needing no code');

  -- …and a real stranger is stopped by it, through the door people use.
  perform set_config('request.jwt.claims', '{"sub":"cp-stranger","role":"authenticated"}', true);
  set role authenticated;
  v := public.join_program(v_slug, 'WRONG123', 'CP Stranger', 'cp-ip-stranger');
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-4g a stranger joined a brand-new program without its code');
  v := public.join_program(v_slug, v_code, 'CP Stranger', 'cp-ip-stranger');
  reset role;

  perform public.t_assert(v ->> 'ok' = 'true',
    'CP-4h the code the program was created with did not let anyone in: ' || coalesce(v ->> 'message', '?'));
  perform public.t_assert(v ->> 'existing' = 'false',
    'CP-4i a first join into a new program reported an existing membership');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 6. CP-5 — the slug, and a second program
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_first text := 'tst-starter-band';
  v_second text;
  v_programs int;
  v_profiles int;
begin
  perform public.t_assert(
    exists (select 1 from public.ensembles where slug = v_first),
    'CP-5 the slug was not derived from the program name');

  -- Same name, second program: a real thing to want (two sections, two
  -- seasons), and it must not fight the first one for a slug.
  perform set_config('request.jwt.claims', '{"sub":"cp-starter","role":"authenticated"}', true);
  set role authenticated;
  v := public.create_program('TST Starter Band', null, 'Ignored Name');
  reset role;

  perform public.t_assert(v ->> 'ok' = 'true',
    'CP-5b a second program with the same name was refused: ' || coalesce(v ->> 'message', '?'));
  v_second := v ->> 'slug';

  perform public.t_assert(v_second is distinct from v_first,
    'CP-5c two programs with the same name were given the same slug');
  perform public.t_assert(v_second like v_first || '-%',
    'CP-5d the collision was not resolved by extending the slug: ' || coalesce(v_second, '?'));
  perform public.t_assert(v_first ~ '^[a-z0-9-]+$' and v_second ~ '^[a-z0-9-]+$',
    'CP-5e a generated slug does not satisfy the ensembles slug rule');

  select count(*) into v_programs from public.ensembles where name = 'TST Starter Band';
  perform public.t_assert(v_programs = 2,
    'CP-5f expected exactly two programs with that name, found ' || v_programs);

  -- Two programs, one person.
  select count(*) into v_profiles from public.profiles where auth_user_id = 'cp-starter';
  perform public.t_assert(v_profiles = 1,
    'CP-5g starting a second program duplicated the person');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 7. CP-6 — the security claim: director of their own program, and of nothing
-- ---------------------------------------------------------------------------
-- This is why "any signed-in person may start a program" is not a hole. If any
-- assertion here can be made to fail, starting a program has become a way to
-- reach somebody else's roster.
do $$
declare
  v jsonb;
  v_band uuid;
  v_mine uuid;
  v_victim uuid;
  v_band_code text;
  v_memberships int;
begin
  select id into v_band from public.ensembles where slug = 'band';
  select id into v_mine from public.ensembles where slug = 'tst-starter-band';
  select id into v_victim from public.profiles where auth_user_id = 'cp-band-student';

  select coalesce(s.join_code, '')
    into v_band_code
    from public.ensembles e
    left join public.ensemble_settings s on s.ensemble_id = e.id
   where e.id = v_band;

  perform set_config('request.jwt.claims', '{"sub":"cp-starter","role":"authenticated"}', true);
  set role authenticated;

  -- Their own program: the code is theirs, so reading it must work. This is the
  -- control that stops the refusals below from passing for the wrong reason.
  v := public.get_join_code(v_mine);
  perform public.t_assert(v ->> 'ok' = 'true',
    'CP-6 the director of a new program cannot read its own join code');
  perform public.t_assert(coalesce(v ->> 'code', '') <> '',
    'CP-6b the director''s own join code came back empty');

  -- Somebody else's program: nothing at all.
  v := public.get_join_code(v_band);
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-6c starting a program handed out the band''s join code');
  perform public.t_assert(v_band_code = '' or position(v_band_code in coalesce(v::text, '')) = 0,
    'CP-6d a refusal carried the band''s join code');

  v := public.deactivate_member(v_band, v_victim);
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-6e starting a program let them deactivate a band member');

  v := public.get_join_code(v_band);
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-6f a second read of the band''s join code was allowed');

  -- Not even readable: RLS still scopes them to the program they made.
  perform public.t_assert(
    (select count(*) from public.events where ensemble_id = v_band) = 0,
    'CP-6g they can read the band''s events after starting their own program');
  perform public.t_assert(
    (select count(*) from public.memberships where ensemble_id = v_band) = 0,
    'CP-6h they can read the band''s roster after starting their own program');
  reset role;

  -- The same claim, stated as data: every membership they hold is in a program
  -- they created themselves. Nothing was inherited, granted or guessed.
  perform public.t_assert(
    not exists (
      select 1
        from public.memberships m
        join public.profiles p on p.id = m.user_id
        join public.ensembles e on e.id = m.ensemble_id
       where p.auth_user_id = 'cp-starter'
         and e.created_by is distinct from p.id
    ),
    'CP-6i they hold a membership in a program they did not create');

  select count(*) into v_memberships
    from public.memberships m join public.profiles p on p.id = m.user_id
   where p.auth_user_id = 'cp-starter';
  perform public.t_assert(v_memberships = 2,
    'CP-6j expected exactly the two programs they started, found ' || v_memberships);

  -- And the band is exactly as it was before they arrived.
  perform public.t_assert(
    (select count(*) from public.memberships m
      where m.ensemble_id = v_band and m.user_id = v_victim and m.active) = 1,
    'CP-6k the band member was deactivated anyway');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 8. CP-7 — five an hour, then stop
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  i integer;
  v_created int;
begin
  perform set_config('request.jwt.claims', '{"sub":"cp-rate","role":"authenticated"}', true);
  set role authenticated;

  for i in 1..5 loop
    v := public.create_program('CP Rate ' || i, null, 'Rate Teacher');
    perform public.t_assert(v ->> 'ok' = 'true',
      'CP-7 program ' || i || ' of five was refused: ' || coalesce(v ->> 'message', '?'));
  end loop;

  v := public.create_program('CP Rate 6', null, 'Rate Teacher');
  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-7b a sixth program was allowed inside the same hour');
  perform public.t_assert(coalesce(v ->> 'message', '') <> '',
    'CP-7c the throttled refusal came with no message to show the person');
  reset role;

  select count(*) into v_created
    from public.ensembles e join public.profiles p on p.id = e.created_by
   where p.auth_user_id = 'cp-rate';
  perform public.t_assert(v_created = 5,
    'CP-7d expected five programs from the throttled account, found ' || v_created);
  perform public.t_assert(
    not exists (select 1 from public.ensembles where name = 'CP Rate 6'),
    'CP-7e the refused call still created the program');
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 9. CP-8 — anon, and the shape of the signature
-- ---------------------------------------------------------------------------
do $$
declare
  v_state text;
  v_args text;
begin
  set role anon;
  begin
    perform public.create_program('CP Anon', null, 'Anon');
    v_state := 'CALLED';
  exception
    when others then
      v_state := sqlstate;
  end;
  reset role;

  perform public.t_assert(v_state = '42501',
    'CP-8 anon could call create_program (sqlstate ' || v_state || ')');

  perform public.t_assert(
    not has_function_privilege('anon', 'public.generate_join_code(int)', 'EXECUTE'),
    'CP-8b anon can mint join codes');

  perform public.t_assert(
    (select prosecdef from pg_proc
      where oid = 'public.create_program(text, text, text, text)'::regprocedure),
    'CP-8c create_program is not SECURITY DEFINER, so it cannot write what it must');

  -- The structural reason CP-6 holds: there is no argument a caller could aim at
  -- a program that already exists, and none that names a role. If this ever
  -- changes, CP-6 has to be re-derived rather than trusted.
  v_args := lower(pg_get_function_arguments('public.create_program(text, text, text, text)'::regprocedure));
  perform public.t_assert(
    v_args not like '%ensemble%'
      and v_args not like '%program%'
      and v_args not like '%roles%'
      and v_args not like '%member%',
    'CP-8d create_program takes something it could be aimed at: ' || v_args);
end $$;
select set_config('request.jwt.claims', '{}', true);

-- ---------------------------------------------------------------------------
-- 10. CP-9 — a paused account
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"cp-paused","role":"authenticated"}', true);
  set role authenticated;

  v := public.create_program('CP Paused Program', null, 'Paused Person');
  reset role;

  perform public.t_assert(v ->> 'ok' = 'false',
    'CP-9 a paused account was allowed to start a program');
  perform public.t_assert(coalesce(v ->> 'message', '') ilike '%paused%',
    'CP-9b the refusal did not explain the pause: ' || coalesce(v ->> 'message', '?'));
end $$;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  -- A pause a director applied must not be walked around by making a new
  -- program, so nothing may have been created on the way to the refusal.
  perform public.t_assert(
    not exists (select 1 from public.ensembles where name = 'CP Paused Program'),
    'CP-9c a paused account still created a program');
end $$;

-- ---------------------------------------------------------------------------
-- 11. Teardown
-- ---------------------------------------------------------------------------
rollback;

select 'CREATE PROGRAM PASSED' as verification_result;
