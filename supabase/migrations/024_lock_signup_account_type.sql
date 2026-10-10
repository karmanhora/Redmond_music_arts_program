-- ============================================================================
-- RHS Music Platform — Migration 024
-- Lock signup account type after account creation
-- ============================================================================
-- Login choices must not classify an existing account. An OAuth account may
-- set its type once, shortly after Supabase creates it; email signup type is
-- already captured by migration 023's auth.users trigger. Existing records
-- always win, and legacy accounts cannot self-classify as teachers at login.
-- ============================================================================

create or replace function public.set_signup_account_type(p_account_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth text := public.current_auth_id();
  v_account_type text;
  v_created_at timestamptz;
begin
  if v_auth is null then
    raise exception 'Sign in first.';
  end if;

  if p_account_type is null or p_account_type not in ('student', 'teacher') then
    raise exception 'Choose student or teacher.';
  end if;

  select account_type into v_account_type
    from public.signup_account_types
   where auth_user_id = v_auth;

  if found then
    return v_account_type;
  end if;

  select created_at into v_created_at
    from auth.users
   where id::text = v_auth;

  if v_created_at is null or v_created_at < now() - interval '1 hour' then
    raise exception 'Signup type can only be set shortly after account creation.';
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

revoke all on function public.set_signup_account_type(text) from public, anon;
grant execute on function public.set_signup_account_type(text) to authenticated, service_role;

do $$
begin
  if position(
    'Signup type can only be set shortly after account creation.'
    in pg_get_functiondef('public.set_signup_account_type(text)'::regprocedure)
  ) = 0 then
    raise exception 'FAIL: signup account type does not reject legacy accounts';
  end if;
  raise notice '024 OK: stored account types cannot be changed, and legacy accounts cannot set one during login';
end
$$;
