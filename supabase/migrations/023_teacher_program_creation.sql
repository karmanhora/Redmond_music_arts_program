-- ============================================================================
-- RHS Music Platform — Migration 023
-- Restrict self-serve program creation to teacher accounts
-- ============================================================================
-- The Student/Teacher choice made at sign-up is stored in a private table.
-- Unlike auth.users.raw_user_meta_data, users cannot edit this record after
-- signup. Email signups are recorded by the auth.users insert trigger; Google
-- OAuth signups record their chosen type once through set_signup_account_type.
-- Existing directors without a recorded type retain the ability to create.
-- ============================================================================

create table if not exists public.signup_account_types (
  auth_user_id text primary key,
  account_type text not null check (account_type in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

alter table public.signup_account_types enable row level security;
revoke all on table public.signup_account_types from public, anon, authenticated;

create or replace function public.record_signup_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_type text := new.raw_user_meta_data ->> 'account_type';
begin
  if v_account_type in ('student', 'teacher') then
    insert into public.signup_account_types (auth_user_id, account_type)
    values (new.id::text, v_account_type)
    on conflict (auth_user_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists on_auth_user_signup_account_type on auth.users;
create trigger on_auth_user_signup_account_type
  after insert on auth.users
  for each row execute function public.record_signup_account_type();

create or replace function public.delete_signup_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.signup_account_types where auth_user_id = old.id::text;
  return old;
end
$$;

drop trigger if exists on_auth_user_delete_signup_account_type on auth.users;
create trigger on_auth_user_delete_signup_account_type
  after delete on auth.users
  for each row execute function public.delete_signup_account_type();

create or replace function public.get_signup_account_type()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select account_type
    from public.signup_account_types
   where auth_user_id = public.current_auth_id()
$$;

create or replace function public.set_signup_account_type(p_account_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth text := public.current_auth_id();
  v_account_type text;
begin
  if v_auth is null then
    raise exception 'Sign in first.';
  end if;

  if p_account_type is null or p_account_type not in ('student', 'teacher') then
    raise exception 'Choose student or teacher.';
  end if;

  insert into public.signup_account_types (auth_user_id, account_type)
  values (v_auth, p_account_type)
  on conflict (auth_user_id) do nothing;

  select account_type into v_account_type
    from public.signup_account_types
   where auth_user_id = v_auth;

  return v_account_type;
end
$$;

revoke all on function public.record_signup_account_type() from public, anon, authenticated;
revoke all on function public.delete_signup_account_type() from public, anon, authenticated;
revoke all on function public.get_signup_account_type() from public, anon;
revoke all on function public.set_signup_account_type(text) from public, anon;
grant execute on function public.get_signup_account_type() to authenticated, service_role;
grant execute on function public.set_signup_account_type(text) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.create_program_unchecked(text, text, text, text)') is null then
    if to_regprocedure('public.create_program(text, text, text, text)') is null then
      raise exception '023 requires public.create_program() from migration 022';
    end if;
    alter function public.create_program(text, text, text, text)
      rename to create_program_unchecked;
  end if;
end
$$;

revoke all on function public.create_program_unchecked(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_program_unchecked(text, text, text, text)
  to service_role;

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
  v_auth text := public.current_auth_id();
  v_profile uuid;
  v_account_type text;
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

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

  return public.create_program_unchecked(
    p_name,
    p_short_name,
    p_display_name,
    p_theme_color
  );
end
$$;

comment on function public.create_program(text, text, text, text) is
  'Start a new program only for a teacher account or an existing director; students join with a director''s code.';

revoke all on function public.create_program(text, text, text, text) from public, anon;
grant execute on function public.create_program(text, text, text, text)
  to authenticated, service_role;

do $$
declare
  v_result jsonb;
  v_program_count int;
begin
  if has_function_privilege(
    'authenticated',
    'public.create_program_unchecked(text, text, text, text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated can execute the unchecked create_program implementation';
  end if;

  insert into public.signup_account_types (auth_user_id, account_type)
  values ('02300000-0000-4000-8000-000000000001', 'student')
  on conflict (auth_user_id) do nothing;

  select count(*) into v_program_count from public.ensembles;
  perform set_config(
    'request.jwt.claims',
    '{"sub":"02300000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );

  if public.set_signup_account_type('teacher') <> 'student' then
    raise exception 'FAIL: signup account type could be changed after its first record';
  end if;

  v_result := public.create_program('Student Cannot Start', null, 'Student');
  if coalesce(v_result ->> 'ok', 'true') <> 'false'
     or coalesce(v_result ->> 'message', '') not ilike '%student accounts join%' then
    raise exception 'FAIL: student account was not refused with an explanation: %', v_result;
  end if;

  if (select count(*) from public.ensembles) <> v_program_count
     or exists (
       select 1 from public.profiles
        where auth_user_id = '02300000-0000-4000-8000-000000000001'
     ) then
    raise exception 'FAIL: a refused student call created a program or profile';
  end if;

  delete from public.signup_account_types
   where auth_user_id = '02300000-0000-4000-8000-000000000001';

  raise notice '023 OK: student creation refused; unchecked implementation unavailable to authenticated';
end
$$;
