-- ============================================================================
-- RHS Music Platform — Migration 022
-- Starting your own program (self-serve, no director in the loop)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why this exists: a teacher could sign up, confirm their email, and then hit a
-- wall. The only door onto a roster was `join_program()` (020), which needs a
-- code from a director who already runs a program — so the first teacher in a
-- new subject had nobody to ask, and "sign up and get started" was not true.
--
-- What this adds:
--   * `ensembles.created_by` — who started the program (audit; also what the
--     abuse guard below counts).
--   * `generate_join_code()` — the 8-character code in the same alphabet the
--     Roster screen shows (no I, O, 0 or 1).
--   * `create_program(name, …)` — one signed-in person names a program and
--     becomes its **director**. It creates the `ensembles` row, a
--     `ensemble_settings` row carrying a fresh join code, and the caller's
--     `memberships` row with `{director}`.
--
-- SECURITY — why this cannot be used to promote yourself:
--   The function takes a *name*, never an ensemble id, and the role it writes is
--   the literal `{director}` on a program it just created. There is no argument
--   that can point it at an existing program, so the worst a caller can do is
--   own a brand-new empty program. Gaining rights on somebody else's program is
--   still impossible: that is `join_program()` (which writes `{student}`) and
--   the director-only roster RPCs.
--
-- Also deliberate here:
--   * **A new program is closed by default.** `validate_join_code()` treats an
--     empty configured code as "no code required", so a program created without
--     one would be joinable by anybody who guessed its slug. Generating a code
--     at creation means it starts closed, and the director can rotate it on the
--     Roster screen.
--   * **A rate guard, not a cap.** A person may start five programs an hour.
--     Five is generous for a teacher with several ensembles and stops a script
--     from filling the program list; there is no lifetime limit, because a new
--     season or a class that got split is a legitimate reason to start another.
--   * **Sections are not created.** A fresh program has none, which is
--     supported everywhere (a member with no section is normal; roster groups
--     them under "No section"). Setting them up is a director's next step.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who started the program
-- ---------------------------------------------------------------------------
alter table public.ensembles add column if not exists created_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ensembles_created_by_fkey'
  ) then
    alter table public.ensembles
      add constraint ensembles_created_by_fkey
      foreign key (created_by) references public.profiles(id) on delete set null;
  end if;
end
$$;

create index if not exists ensembles_created_by_idx on public.ensembles (created_by);

comment on column public.ensembles.created_by is
  'The person who started this program via create_program(); null for the ones seeded by migration.';

-- ---------------------------------------------------------------------------
-- 2. Join codes
-- ---------------------------------------------------------------------------
-- No I, O, 0 or 1: a code gets read off a whiteboard and typed by a teenager.
-- The same alphabet and length the Roster screen generates client-side.
create or replace function public.generate_join_code(p_length int default 8)
returns text
language sql
volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  (floor(random() * 32) + 1)::int,
                  1),
           ''
         )
    from generate_series(1, greatest(4, least(coalesce(p_length, 8), 32)))
$$;

comment on function public.generate_join_code(int) is
  'A fresh join code (Crockford-ish alphabet, no I/O/0/1). Used by create_program(); never returned to a non-director.';

revoke all on function public.generate_join_code(int) from public, anon;
grant execute on function public.generate_join_code(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Start a program
-- ---------------------------------------------------------------------------
create or replace function public.create_program(
  p_name         text,
  p_short_name   text default null,
  p_display_name text default null,
  p_theme_color  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth    text := public.current_auth_id();
  v_profile uuid;
  v_paused  boolean;
  v_name    text;
  v_short   text;
  v_color   text;
  v_slug    text;
  v_try     text;
  v_n       int := 1;
  v_created int;
  v_ens     uuid;
  v_code    text;
  v_member  uuid;
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  v_name := left(btrim(coalesce(p_name, '')), 80);
  if length(v_name) < 2 then
    return jsonb_build_object(
      'ok', false,
      'message', 'Give your program a name — at least two letters.'
    );
  end if;

  select id, deactivated into v_profile, v_paused
    from public.profiles
   where auth_user_id = v_auth;

  if v_profile is not null and v_paused then
    return jsonb_build_object(
      'ok', false,
      'message', 'This account has been paused — talk to your director.'
    );
  end if;

  -- Abuse guard (see the header): five an hour is plenty for real teaching.
  if v_profile is not null then
    select count(*) into v_created
      from public.ensembles
     where created_by = v_profile
       and created_at > now() - interval '1 hour';

    if v_created >= 5 then
      return jsonb_build_object(
        'ok', false,
        'message', 'You have started several programs already — try again in an hour.'
      );
    end if;
  end if;

  -- Their first anything: create the person, exactly as join_program() does.
  if v_profile is null then
    insert into public.profiles (id, auth_user_id, full_name, display_name)
    values (
      gen_random_uuid(),
      v_auth,
      left(btrim(coalesce(p_display_name, '')), 80),
      left(btrim(coalesce(p_display_name, '')), 80)
    )
    returning id into v_profile;
  end if;

  ---------------------------------------------------------------------------
  -- A slug nobody has: from the name, then -2, -3 … (and a random tail if a
  -- pathological run of collisions runs past the loop).
  ---------------------------------------------------------------------------
  v_slug := left(
    coalesce(
      nullif(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), ''),
      'program'
    ),
    40
  );

  v_try := v_slug;
  while exists (select 1 from public.ensembles where slug = v_try) loop
    v_n := v_n + 1;
    exit when v_n > 50;
    v_try := left(v_slug, 34) || '-' || v_n;
  end loop;

  if exists (select 1 from public.ensembles where slug = v_try) then
    v_try := left(v_slug, 30) || '-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  v_slug := v_try;

  v_short := left(coalesce(nullif(btrim(coalesce(p_short_name, '')), ''), v_name), 40);

  -- Only a literal hex colour is accepted; anything else falls back to the
  -- house default rather than painting the app something invalid.
  v_color := lower(btrim(coalesce(p_theme_color, '')));
  if v_color !~ '^#[0-9a-f]{6}$' then
    v_color := '#214d35';
  end if;

  insert into public.ensembles (slug, name, short_name, theme_color, created_by)
  values (v_slug, v_name, v_short, v_color, v_profile)
  returning id into v_ens;

  -- Closed by default: nobody joins without the code the director can rotate.
  v_code := public.generate_join_code(8);
  insert into public.ensemble_settings (ensemble_id, join_code)
  values (v_ens, v_code)
  on conflict (ensemble_id) do update set join_code = excluded.join_code;

  insert into public.memberships (user_id, ensemble_id, roles, active)
  values (v_profile, v_ens, '{director}'::public.app_role[], true)
  returning id into v_member;

  return jsonb_build_object(
    'ok', true,
    'program_id', v_ens,
    'slug', v_slug,
    'name', v_name,
    'join_code', v_code,
    'profile_id', v_profile,
    'membership_id', v_member,
    'message', 'Your program is ready.'
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'message', 'Could not create the program — try again.'
    );
end
$$;

comment on function public.create_program(text, text, text, text) is
  'Start a program and become its director. Creates the program, its join code and the caller''s director membership. Never touches an existing program.';

-- ---------------------------------------------------------------------------
-- 4. Grants — signed-in people only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.create_program(text, text, text, text) from public, anon;
grant execute on function public.create_program(text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
-- Structural first — no writes, so nothing to clean up.
do $$
declare
  v_anon text;
  v_def  text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ensembles'
       and column_name = 'created_by'
  ) then
    raise exception 'FAIL: ensembles.created_by was not created';
  end if;

  if to_regprocedure('public.create_program(text, text, text, text)') is null then
    raise exception 'FAIL: create_program() was not created';
  end if;

  -- Must not be reachable by anon.
  select string_agg(p.proname, ', ') into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_program', 'generate_join_code')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon is not null then
    raise exception 'FAIL: anon can execute: %', v_anon;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.create_program(text, text, text, text)'::regprocedure
       and p.prosecdef
  ) then
    raise exception 'FAIL: create_program() must be SECURITY DEFINER';
  end if;

  -- It must not accept an existing program in any argument.
  v_def := pg_get_function_arguments('public.create_program(text, text, text, text)'::regprocedure);
  if v_def like '%ensemble%' or v_def like '%program_id%' or v_def like '%p_roles%' then
    raise exception 'FAIL: create_program() takes something it could be pointed at: %', v_def;
  end if;

  raise notice 'create_program structure OK: exists, SECURITY DEFINER, anon denied, takes a name and nothing else';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Functional check — then undo it
-- ---------------------------------------------------------------------------
-- The writes below (a program, a profile, a membership) happen inside a
-- subtransaction that is rolled back on purpose, so applying this migration
-- leaves no fixture row behind. plpgsql variables survive a subtransaction
-- rollback, which is how the result is carried out of it. A real failure
-- re-raises and aborts the migration; only the sentinel is swallowed.
do $$
declare
  v_new     uuid;
  v_slug    text;
  v_code    text;
  v_perm    int;
  v_r       jsonb;
  v_profile uuid;
  v_head    int;
  v_done    boolean := false;
begin
  select count(*) into v_head from public.ensembles;

  begin
    perform set_config(
      'request.jwt.claims',
      '{"sub":"02200000-0000-4000-8000-000000000001","role":"authenticated"}',
      true
    );

    v_r := public.create_program('Verification Orchestra', 'V.O.', 'Verifier');
    if coalesce(v_r ->> 'ok', 'false') <> 'true' then
      raise exception 'FAIL: create_program() refused: %', v_r ->> 'message';
    end if;

    v_new  := (v_r ->> 'program_id')::uuid;
    v_slug := v_r ->> 'slug';
    v_code := v_r ->> 'join_code';

    if v_slug <> 'verification-orchestra' then
      raise exception 'FAIL: unexpected slug %', v_slug;
    end if;
    if coalesce(v_code, '') = '' then
      raise exception 'FAIL: the new program was left open (no join code)';
    end if;

    select id into v_profile from public.profiles
     where auth_user_id = '02200000-0000-4000-8000-000000000001';
    if v_profile is null then
      raise exception 'FAIL: no profile was created for the caller';
    end if;

    select count(*) into v_perm
      from public.memberships
     where user_id = v_profile
       and ensemble_id = v_new
       and active
       and roles = '{director}'::public.app_role[];
    if v_perm <> 1 then
      raise exception 'FAIL: the creator is not an active director of their own program';
    end if;

    if (select count(*) from public.ensembles where created_by = v_profile) <> 1 then
      raise exception 'FAIL: created_by was not recorded';
    end if;

    -- A second program gets its own slug rather than colliding.
    v_r := public.create_program('Verification Orchestra', null, null);
    if (v_r ->> 'slug') = v_slug then
      raise exception 'FAIL: two programs were given the same slug';
    end if;

    -- A blank name is refused.
    v_r := public.create_program('   ', null, null);
    if coalesce(v_r ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: a blank program name was accepted';
    end if;

    -- Signed out: refused.
    perform set_config('request.jwt.claims', '{}', true);
    v_r := public.create_program('Nobody Program', null, null);
    if coalesce(v_r ->> 'ok', 'true') <> 'false' then
      raise exception 'FAIL: a signed-out caller created a program';
    end if;

    v_done := true;
    raise exception 'ROLLBACK_CREATE_PROGRAM_CHECK';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_CREATE_PROGRAM_CHECK' then
        raise;
      end if;
  end;

  if not v_done then
    raise exception 'FAIL: the create_program functional check did not reach its end';
  end if;

  if (select count(*) from public.ensembles) <> v_head then
    raise exception 'FAIL: the verification left a program behind';
  end if;

  raise notice 'create_program OK: new profile became director of a new, closed program; collision handled; blank and signed-out refused; fixtures rolled back';
end
$$;
