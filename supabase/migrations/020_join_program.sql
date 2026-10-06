-- ============================================================================
-- RHS Music Platform — Migration 020
-- Joining a program from inside the app
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why this exists: until now the only door onto a roster was the Clerk
-- `user.created` webhook (§13.2). That webhook fires ONCE per account, so it can
-- never add somebody's *second* program — a student in both band and choir would
-- be stuck in whichever one they signed up with — and it is not deployed yet, so
-- in practice nobody new can join anything at all.
--
-- These three functions move the join flow into the app without weakening it:
--
--   current_clerk_id()      the caller's Clerk `sub` straight from the token
--   list_active_programs()  the real programs, so nobody has to spell a slug
--                           (names and colours are public; CODES ARE NEVER RETURNED)
--   join_program(...)       validates the code and creates profile + membership
--
-- The join code is still verified server-side, through the SAME rate-limited gate
-- the webhook uses (`validate_join_code`, 5 failures / 2 minutes per IP), and the
-- function is reachable only by a signed-in person — never `anon`. The webhook
-- remains for pre-provisioning; this is the path people actually use.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who is calling? (identity straight from the Clerk-issued token)
-- ---------------------------------------------------------------------------
-- `auth.uid()` cannot answer this: Supabase casts `sub` to uuid and a Clerk id is
-- `user_…`. `profiles.clerk_id` is the mapping, so the raw claim is what we need.
create or replace function public.current_clerk_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
$$;

comment on function public.current_clerk_id() is
  'The caller''s Clerk user id from the session token, or null when signed out.';

-- ---------------------------------------------------------------------------
-- 2. The programs a person may join
-- ---------------------------------------------------------------------------
create or replace function public.list_active_programs()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', e.slug,
        'name', e.name,
        'short_name', e.short_name,
        'theme_color', e.theme_color,
        'logo_url', e.logo_url,
        -- Whether a code is needed at all — never the code itself.
        'has_join_code', coalesce(nullif(s.join_code, ''), '') <> ''
      )
      order by e.name
    ),
    '[]'::jsonb
  )
    from public.ensembles e
    left join public.ensemble_settings s on s.ensemble_id = e.id
   where e.active
$$;

comment on function public.list_active_programs() is
  'Active programs for the join screen: names, colours and whether a code is needed — never a code.';

-- ---------------------------------------------------------------------------
-- 3. Join one program with its code
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
  v_clerk      text := public.current_clerk_id();
  v_ensemble   uuid;
  v_ename      text;
  v_profile    uuid;
  v_deactivated boolean;
  v_member_id  uuid;
  v_member_on  boolean;
  v_check      jsonb;
  v_name       text;
begin
  if v_clerk is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  select id, name into v_ensemble, v_ename
    from public.ensembles
   where slug = p_slug
     and active;

  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'That program isn''t available.');
  end if;

  -- The same gate the signup webhook uses, including its per-IP lockout.
  v_check := public.validate_join_code(p_slug, p_code, p_ip);
  if coalesce(v_check ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_check ->> 'message', 'That join code isn''t right.')
    );
  end if;

  select id, deactivated into v_profile, v_deactivated
    from public.profiles
   where clerk_id = v_clerk;

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

    insert into public.profiles (id, clerk_id, full_name, display_name)
    values (gen_random_uuid(), v_clerk, v_name, v_name)
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
-- 4. Grants — signed-in people only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.current_clerk_id()                          from public, anon;
revoke all on function public.list_active_programs()                      from public, anon;
revoke all on function public.join_program(text, text, text, text)         from public, anon;

grant execute on function public.current_clerk_id()                       to authenticated, service_role;
grant execute on function public.list_active_programs()                   to authenticated, service_role;
grant execute on function public.join_program(text, text, text, text)      to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon text;
begin
  if to_regprocedure('public.join_program(text, text, text, text)') is null then
    raise exception 'FAIL: join_program() was not created';
  end if;
  if to_regprocedure('public.list_active_programs()') is null then
    raise exception 'FAIL: list_active_programs() was not created';
  end if;

  -- The identity helpers this migration depends on must exist (016).
  if to_regprocedure('public.validate_join_code(text, text, text)') is null then
    raise exception 'FAIL: validate_join_code() missing — 016 must be applied first';
  end if;

  select string_agg(p.proname, ', ')
    into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('join_program', 'list_active_programs', 'current_clerk_id')
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_anon is not null then
    raise exception 'FAIL: anon can execute: %', v_anon;
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'join_program' and p.prosecdef
  ) then
    raise exception 'FAIL: join_program() must be SECURITY DEFINER';
  end if;

  raise notice 'join flow OK: join_program + list_active_programs (signed-in only, code still server-side)';
end
$$;
