-- ============================================================================
-- RHS Music Platform — Migration 021
-- Supabase Auth is the identity provider again (Clerk is retired)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `profiles.auth_user_id text unique` — the Supabase Auth user id
--      (`auth.uid()`), the new mapping from an account to a person. Added
--      NULLABLE: the backfill below fills it for anybody who can be matched
--      exactly, and `join_program()` fills it for everybody else the first time
--      they join a program.
--   2. One exact, non-guessing backfill: profiles that were created under
--      Supabase Auth *before* Clerk replaced it kept `profiles.id =
--      auth.users.id` (015-era schema, FK dropped in 018). Where such an
--      `auth.users` row still exists, that row IS the account, so the link is
--      `auth_user_id = id::text`.
--   3. `current_auth_id()` — the caller's Supabase Auth id, straight from the
--      JWT `sub` claim. Identical to `auth.uid()::text` for any Supabase-issued
--      token (`auth.uid()` is defined as exactly this claim cast to uuid), read
--      as text for two reasons: `profiles.auth_user_id` needs no cast — so the
--      unique index stays usable — and the SQL test personas can carry fixture
--      ids without pretending to be uuids.
--   4. `current_profile_id()` repointed at `profiles.auth_user_id`. This is the
--      single line that moves the whole authorization layer: every RLS policy,
--      every guard trigger and every RPC in 013/015/016/017/019/020 composes on
--      this helper, so none of them change.
--   5. `current_clerk_id()` dropped (superseded by `current_auth_id()`).
--   6. `join_program()` and `register_signup()` rewritten onto the new column
--      and the new helper. Signatures are unchanged apart from parameter names,
--      so the 017 existence checks and every existing caller keep working.
--
-- What this deliberately does NOT do:
--   * It does not drop `profiles.clerk_id`. The column is historical now (the
--     three live profiles all have `clerk_id = NULL` — [03b] was never run), but
--     dropping it before the cutover is verified would remove the only record of
--     which Clerk account a row was meant for. Nothing reads it any more; a
--     later migration can drop it once you are satisfied.
--   * It does not `set not null` on either identity column. A row with no linked
--     account resolves to NULL and every helper denies — fail-closed, which is
--     what we want while people are still signing in for the first time.
--   * It does not re-create an `auth.users` signup trigger. The join code is
--     collected on the join screen (`join_program`, 020) *after* the account
--     exists, which is the only flow that can serve somebody's second program.
--     `handle_new_user` stays retired (018).
--   * It does not touch a single table, row or policy outside `profiles`
--     identity. Attendance, rosters, events, sections, theme tokens, calendar
--     sources and analytics are untouched.
--
-- NOT covered here — the one manual step, only if it turns out you need it:
--   Profiles that (a) have no matching `auth.users` row, so the exact backfill
--   above skipped them, and (b) belong to a real person now signing up fresh.
--   Those need an administrator to link the account to the existing profile by
--   email, so the person keeps their attendance history instead of getting a
--   second profile. The reviewed SQL is in docs/AUTH_MIGRATION.md §4 — it is not
--   run automatically, because choosing which account owns a history is a
--   decision about real people, not something a migration should guess.
--
-- Rollback: this migration is additive. To revert to the Clerk mapping, restore
-- 013's `current_profile_id()` body (it is quoted in docs/AUTH_MIGRATION.md §8)
-- and redeploy the Clerk frontend; `clerk_id` and every `auth_user_id` stay
-- where they are.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The identity column
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists auth_user_id text;

-- Unique among non-null values (Postgres allows many NULLs in a unique index),
-- so this is safe to apply before anyone has signed in.
create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id);

comment on column public.profiles.auth_user_id is
  'Supabase Auth user id (auth.uid()). Identity for RLS via current_profile_id().';

comment on column public.profiles.clerk_id is
  'Legacy Clerk user id (user_…). Superseded by auth_user_id in 021; no longer read.';

-- ---------------------------------------------------------------------------
-- 2. Backfill — only exact matches, never a guess
-- ---------------------------------------------------------------------------
-- Under the pre-Clerk schema `profiles.id` mirrored `auth.users.id`, so a
-- surviving auth users row with that uuid is provably the same account.
do $$
declare
  v_linked int;
  v_left   int;
begin
  update public.profiles p
     set auth_user_id = p.id::text
   where p.auth_user_id is null
     and exists (select 1 from auth.users u where u.id = p.id);

  get diagnostics v_linked = row_count;

  select count(*) into v_left
    from public.profiles
   where auth_user_id is null;

  raise notice '021: linked % profile(s) to an existing auth.users row; % profile(s) still unlinked (they link on first join).',
    v_linked, v_left;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Identity helper: who is calling? (Supabase Auth `sub` claim)
-- ---------------------------------------------------------------------------
create or replace function public.current_auth_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
$$;

comment on function public.current_auth_id() is
  'The caller''s Supabase Auth user id from the session token, or null when signed out.';

-- ---------------------------------------------------------------------------
-- 4. Identity helper: which person is calling?
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.profiles p
   where p.auth_user_id = public.current_auth_id()
$$;

comment on function public.current_profile_id() is
  'profiles.id of the signed-in user, resolved from the Supabase Auth token (sub claim).';

-- The Clerk-era helper. Dropped rather than renamed so nothing can silently
-- keep resolving identity the old way.
drop function if exists public.current_clerk_id();

-- ---------------------------------------------------------------------------
-- 5. Joining a program — same flow, new identity
-- ---------------------------------------------------------------------------
create or replace function public.join_program(
  p_slug         text,
  p_code         text,
  p_display_name text default null,
  p_ip           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth       text := public.current_auth_id();
  v_ensemble   uuid;
  v_ename      text;
  v_profile    uuid;
  v_deactivated boolean;
  v_member_id  uuid;
  v_member_on  boolean;
  v_check      jsonb;
  v_name       text;
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  select id, name into v_ensemble, v_ename
    from public.ensembles
   where slug = p_slug
     and active;

  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'That program isn''t available.');
  end if;

  -- The rate-limited join-code gate, unchanged.
  v_check := public.validate_join_code(p_slug, p_code, p_ip);
  if coalesce(v_check ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_check ->> 'message', 'That join code isn''t right.')
    );
  end if;

  select id, deactivated into v_profile, v_deactivated
    from public.profiles
   where auth_user_id = v_auth;

  if v_profile is not null and v_deactivated then
    return jsonb_build_object(
      'ok', false,
      'message', 'This account has been paused — talk to your director.'
    );
  end if;

  if v_profile is null then
    -- Their first program: create the person. The name is theirs to give, so a
    -- blank stays blank rather than inventing one; it is trimmed and capped.
    v_name := left(btrim(coalesce(p_display_name, '')), 80);

    insert into public.profiles (id, auth_user_id, full_name, display_name)
    values (gen_random_uuid(), v_auth, v_name, v_name)
    returning id into v_profile;
  end if;

  -- `v_member_on` distinguishes "already in" from "was removed" — the two need
  -- different answers.
  select m.id, m.active into v_member_id, v_member_on
    from public.memberships m
   where m.user_id = v_profile
     and m.ensemble_id = v_ensemble;

  if v_member_id is not null then
    if v_member_on then
      return jsonb_build_object(
        'ok', true, 'existing', true,
        'profile_id', v_profile, 'program_id', v_ensemble,
        'program_name', v_ename, 'membership_id', v_member_id,
        'message', 'You''re already on this roster.'
      );
    end if;

    -- A director removed them. Re-entering the code must NOT undo that: the
    -- roster is the director's decision, and `guard_membership_change` would
    -- refuse the update anyway. Say so plainly instead of failing generically.
    return jsonb_build_object(
      'ok', false,
      'message', 'A director removed you from this program — ask them to add you back.'
    );
  end if;

  insert into public.memberships (user_id, ensemble_id, roles, active)
  values (v_profile, v_ensemble, '{student}'::public.app_role[], true)
  returning id into v_member_id;

  return jsonb_build_object(
    'ok', true, 'existing', false,
    'profile_id', v_profile, 'program_id', v_ensemble,
    'program_name', v_ename, 'membership_id', v_member_id,
    'message', 'You''re on the roster.'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', 'Could not join this program — try again.');
end
$$;

comment on function public.join_program(text, text, text, text) is
  'Join a program with its join code. Creates the profile on first join; idempotent afterwards.';

-- ---------------------------------------------------------------------------
-- 6. Pre-provisioning — same signature, Supabase Auth identity
-- ---------------------------------------------------------------------------
-- Kept because service-role provisioning is still a legitimate way to put
-- somebody on a roster before they open the app (the old `user.created`
-- webhook's job). Nothing calls it in v1: the in-app join above covers every
-- real case and is the only path that can add a *second* program.
--
-- DROPPED before it is redefined, which every other function here does not need:
-- `create or replace` refuses to rename an input parameter, and 016's version
-- names the first one `p_clerk_id`. Replacing it in place aborts the whole
-- migration with
--   ERROR:  cannot change name of input parameter "p_clerk_id"
-- The grants are re-issued at the end of this file, so dropping them here costs
-- nothing. Nothing else in the database depends on this function, so it can go.
drop function if exists public.register_signup(text, text, text, text, text, text);

create or replace function public.register_signup(
  p_auth_user_id text,
  p_full_name    text,
  p_slug         text,
  p_join_code    text,
  p_section_name text default '',
  p_ip           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ensemble uuid;
  v_existing uuid;
  v_profile  uuid;
  v_section  uuid;
  v_check    jsonb;
begin
  if coalesce(trim(p_auth_user_id), '') = '' then
    return jsonb_build_object('ok', false, 'message', 'Missing Supabase Auth user id.');
  end if;

  select id into v_ensemble
    from public.ensembles
   where slug = p_slug
     and active;
  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'That program isn''t available.');
  end if;

  -- Idempotency: a profile for this account already exists.
  select id into v_existing from public.profiles where auth_user_id = p_auth_user_id;
  if v_existing is not null then
    select s.id into v_section
      from public.sections s
     where s.ensemble_id = v_ensemble
       and s.name = trim(coalesce(p_section_name, ''))
     limit 1;

    insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
    values (v_existing, v_ensemble, v_section, '{student}'::public.app_role[], true)
    on conflict (user_id, ensemble_id) do nothing;

    return jsonb_build_object('ok', true, 'profile_id', v_existing, 'existing', true);
  end if;

  -- The join-code gate (same rate-limited logic as validate_join_code).
  v_check := public.validate_join_code(p_slug, p_join_code, p_ip);
  if coalesce(v_check ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_check ->> 'message', 'That join code isn''t right.')
    );
  end if;

  v_profile := gen_random_uuid();

  insert into public.profiles (id, auth_user_id, full_name, display_name)
  values (v_profile, trim(p_auth_user_id), coalesce(p_full_name, ''), coalesce(p_full_name, ''));

  select s.id into v_section
    from public.sections s
   where s.ensemble_id = v_ensemble
     and s.name = trim(coalesce(p_section_name, ''))
   limit 1;

  insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
  values (v_profile, v_ensemble, v_section, '{student}'::public.app_role[], true);

  return jsonb_build_object('ok', true, 'profile_id', v_profile);
end
$$;

comment on function public.register_signup(text, text, text, text, text, text) is
  'Service-role provisioning: validate a join code, then create profiles + memberships. Idempotent by auth_user_id.';

-- ---------------------------------------------------------------------------
-- 7. Grants — signed-in users only. Never PUBLIC, never anon.
-- ---------------------------------------------------------------------------
revoke all on function public.current_auth_id()                                 from public, anon;
revoke all on function public.current_profile_id()                              from public, anon;
revoke all on function public.join_program(text, text, text, text)              from public, anon;
revoke all on function public.register_signup(text, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.current_auth_id()                                 to authenticated, service_role;
grant execute on function public.current_profile_id()                              to authenticated, service_role;
grant execute on function public.join_program(text, text, text, text)              to authenticated, service_role;
grant execute on function public.register_signup(text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Verification — the identity layer really moved, and it fails closed
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_anon text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'auth_user_id'
  ) then
    raise exception 'FAIL: profiles.auth_user_id was not created';
  end if;

  -- current_profile_id() must resolve through the new column...
  v_def := pg_get_functiondef('public.current_profile_id()'::regprocedure);
  if v_def not like '%auth_user_id%' then
    raise exception 'FAIL: current_profile_id() does not read profiles.auth_user_id';
  end if;
  if v_def like '%clerk_id%' then
    raise exception 'FAIL: current_profile_id() still reads profiles.clerk_id';
  end if;

  -- ...and must go through the Supabase Auth claim.
  v_def := pg_get_functiondef('public.current_auth_id()'::regprocedure);
  if v_def not like '%request.jwt.claims%' then
    raise exception 'FAIL: current_auth_id() is not reading the JWT claims';
  end if;

  -- The Clerk-era helper must be gone.
  if to_regprocedure('public.current_clerk_id()') is not null then
    raise exception 'FAIL: current_clerk_id() still exists';
  end if;

  -- Signed out, identity is null and nothing resolves.
  perform set_config('request.jwt.claims', '{}', true);
  if public.current_auth_id() is not null then
    raise exception 'FAIL: current_auth_id() answered while signed out';
  end if;
  if public.current_profile_id() is not null then
    raise exception 'FAIL: current_profile_id() answered while signed out';
  end if;

  -- An unknown account resolves to NULL (fail closed), not to somebody else.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}',
    true
  );
  if public.current_profile_id() is not null then
    raise exception 'FAIL: an unknown auth user resolved to a profile';
  end if;
  perform set_config('request.jwt.claims', '{}', true);

  -- No identity helper may be reachable by `anon`.
  select string_agg(p.proname, ', ')
    into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('current_auth_id', 'current_profile_id', 'join_program', 'register_signup')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_anon is not null then
    raise exception 'FAIL: anon can execute: %', v_anon;
  end if;

  -- Both identity paths must stay SECURITY DEFINER, or a policy could recurse.
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.current_profile_id()'::regprocedure
       and p.prosecdef
  ) then
    raise exception 'FAIL: current_profile_id() must be SECURITY DEFINER';
  end if;

  raise notice 'Supabase Auth identity OK: profiles.auth_user_id ← JWT sub, RLS shape unchanged, anon denied';
end
$$;
