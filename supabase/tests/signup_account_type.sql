-- ============================================================================
-- signup_account_type.sql — signup type is immutable after initial assignment
-- ============================================================================
-- Exercises the same setter used by the Google OAuth callback. All fixtures
-- are rolled back; no real auth accounts or signup types are changed.
--
--   SAT-1  a student cannot set the same account to teacher later
--   SAT-2  a newly-created OAuth account can record its initial type
--   SAT-3  an older account with no type cannot classify itself during login
--
-- On success it prints: SIGNUP ACCOUNT TYPE PASSED
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.set_signup_account_type(text)') is null then
    raise exception 'FAIL: SAT-0 set_signup_account_type() missing — apply migration 024 first';
  end if;
end
$$;

insert into public.signup_account_types (auth_user_id, account_type)
values ('02400000-0000-4000-8000-000000000001', 'student')
on conflict (auth_user_id) do nothing;

insert into auth.users (id, aud, role, email, created_at, updated_at, raw_user_meta_data)
values
  ('02400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'sat-new-oauth@example.invalid', now(), now(), '{}'::jsonb),
  ('02400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'sat-old-account@example.invalid', now() - interval '2 hours', now(), '{}'::jsonb);

do $$
declare
  v_type text;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"02400000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );
  v_type := public.set_signup_account_type('teacher');
  if v_type <> 'student' then
    raise exception 'FAIL: SAT-1 existing student account changed to %', v_type;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"02400000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
  v_type := public.set_signup_account_type('teacher');
  if v_type <> 'teacher' then
    raise exception 'FAIL: SAT-2 new OAuth account could not record its initial type';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"02400000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
  );
  begin
    perform public.set_signup_account_type('teacher');
    raise exception 'FAIL: SAT-3 an existing unclassified account set itself to teacher';
  exception
    when raise_exception then
      if sqlerrm not like 'Signup type can only be set shortly after account creation.%' then
        raise;
      end if;
  end;
end
$$;

select set_config('request.jwt.claims', '{}', true);
rollback;

select 'SIGNUP ACCOUNT TYPE PASSED' as verification_result;
