-- Account deletion removes identity data but preserves historical attendance.
begin;

do $$
begin
  if to_regprocedure('public.prepare_account_deletion(text)') is null then
    raise exception 'FAIL: DA-0 prepare_account_deletion() missing — apply migration 025 first';
  end if;
end
$$;

insert into public.profiles (
  id, full_name, display_name, avatar_url, auth_user_id, clerk_id
) values (
  '02500000-0000-4000-8000-000000000001',
  'Deletion Test User',
  'Test User',
  'https://example.invalid/avatar.png',
  '02500000-0000-4000-8000-000000000001',
  'clerk_test_deletion_user'
);

insert into public.ensembles (id, slug, name)
values ('02500000-0000-4000-8000-000000000002', 'deletion-test-program', 'Deletion Test Program');

insert into public.memberships (user_id, ensemble_id, roles)
values (
  '02500000-0000-4000-8000-000000000001',
  '02500000-0000-4000-8000-000000000002',
  '{director}'
);

insert into public.events (id, ensemble_id, name, type, date, created_by)
values (
  '02500000-0000-4000-8000-000000000003',
  '02500000-0000-4000-8000-000000000002',
  'Deletion Test Event',
  'rehearsal',
  now() - interval '1 day',
  '02500000-0000-4000-8000-000000000001'
);

insert into public.attendance_records (id, event_id, student_id, attended, status, marked_by)
values (
  '02500000-0000-4000-8000-000000000004',
  '02500000-0000-4000-8000-000000000003',
  '02500000-0000-4000-8000-000000000001',
  true,
  'present',
  '02500000-0000-4000-8000-000000000001'
);

insert into public.signup_account_types (auth_user_id, account_type)
values ('02500000-0000-4000-8000-000000000001', 'teacher');

select public.prepare_account_deletion('02500000-0000-4000-8000-000000000001');

do $$
begin
  if not exists (
    select 1 from public.attendance_records
     where id = '02500000-0000-4000-8000-000000000004'
       and student_id = '02500000-0000-4000-8000-000000000001'
       and attended and status = 'present' and marked_by is null
  ) then
    raise exception 'FAIL: DA-1 attendance history was not preserved and de-attributed';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = '02500000-0000-4000-8000-000000000001'
       and full_name = 'Deleted account'
       and display_name = 'Deleted account'
       and avatar_url = ''
       and auth_user_id is null
       and clerk_id is null
       and deactivated
  ) then
    raise exception 'FAIL: DA-2 profile was not de-identified';
  end if;

  if exists (
    select 1 from public.memberships
     where user_id = '02500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: DA-3 program membership was retained';
  end if;

  if (select active from public.ensembles
       where id = '02500000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: DA-4 sole-director program was not archived';
  end if;

  if exists (
    select 1 from public.signup_account_types
     where auth_user_id = '02500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: DA-5 signup type was retained';
  end if;
end
$$;

-- A retry is safe if auth.users deletion failed after profile anonymization.
select public.prepare_account_deletion('02500000-0000-4000-8000-000000000001');

rollback;
select 'DELETE ACCOUNT PASSED' as verification_result;
