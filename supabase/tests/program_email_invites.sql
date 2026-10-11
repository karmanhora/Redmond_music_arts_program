-- Program email invitations are limited to program staff and enroll the student only
-- after the invited email is confirmed.
begin;

do $$
begin
  if to_regprocedure('public.create_program_invite(uuid, text, text)') is null then
    raise exception 'FAIL: PEI-0 create_program_invite() missing — apply migration 027 first';
  end if;
  if has_table_privilege('authenticated', 'public.program_invites', 'select') then
    raise exception 'FAIL: PEI-0a authenticated can read private program invitations';
  end if;
end
$$;

insert into public.profiles (id, auth_user_id, full_name, display_name)
values
  ('02700000-0000-4000-8000-000000000001', '027-director', 'Invite Director', 'Invite Director'),
  ('02700000-0000-4000-8000-000000000002', '027-student', 'Invite Student', 'Invite Student'),
  ('02700000-0000-4000-8000-000000000004', '027-existing', 'Existing Student', 'Existing Student'),
  ('02700000-0000-4000-8000-000000000005', '027-secretary', 'Invite Secretary', 'Invite Secretary'),
  ('02700000-0000-4000-8000-000000000006', '027-section-leader', 'Invite Section Leader', 'Invite Section Leader');

insert into public.ensembles (id, slug, name)
values ('02700000-0000-4000-8000-000000000003', 'invite-test-program', 'Invite Test Program');

insert into public.memberships (user_id, ensemble_id, roles)
values
  ('02700000-0000-4000-8000-000000000001', '02700000-0000-4000-8000-000000000003', '{director}'),
  ('02700000-0000-4000-8000-000000000002', '02700000-0000-4000-8000-000000000003', '{student}'),
  ('02700000-0000-4000-8000-000000000004', '02700000-0000-4000-8000-000000000003', '{student}'),
  ('02700000-0000-4000-8000-000000000005', '02700000-0000-4000-8000-000000000003', '{secretary}'),
  ('02700000-0000-4000-8000-000000000006', '02700000-0000-4000-8000-000000000003', '{section_leader}');

select set_config(
  'request.jwt.claims',
  '{"sub":"027-director","role":"authenticated"}',
  true
);
select public.create_program_invite(
  '02700000-0000-4000-8000-000000000003',
  'New.Student@example.edu',
  'New Student'
);
select public.create_program_invite(
  '02700000-0000-4000-8000-000000000003',
  'existing.student@example.edu',
  'Existing Student'
);
update public.memberships
   set active = false
 where user_id = '02700000-0000-4000-8000-000000000004'
   and ensemble_id = '02700000-0000-4000-8000-000000000003';

do $$
begin
  if exists (
    select 1 from public.profiles where auth_user_id = '027-invited'
  ) then
    raise exception 'FAIL: PEI-1 invitation created the student before email acceptance';
  end if;
end
$$;

select public.accept_pending_program_invites(
  '027-invited',
  'new.student@example.edu'
);
select public.accept_pending_program_invites(
  '027-existing',
  'existing.student@example.edu'
);

do $$
declare
  v_profile uuid;
begin
  select id into v_profile
    from public.profiles
   where auth_user_id = '027-invited'
     and full_name = 'New Student'
     and display_name = 'New Student';
  if v_profile is null then
    raise exception 'FAIL: PEI-2 acceptance did not create the invited profile';
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = v_profile
       and ensemble_id = '02700000-0000-4000-8000-000000000003'
       and active
       and roles = '{student}'::public.app_role[]
  ) then
    raise exception 'FAIL: PEI-3 accepted invite did not add the student to the roster';
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = '02700000-0000-4000-8000-000000000004'
       and ensemble_id = '02700000-0000-4000-8000-000000000003'
       and active
       and roles @> '{student}'::public.app_role[]
  ) then
    raise exception 'FAIL: PEI-3a invite did not reactivate the existing student membership';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"027-student","role":"authenticated"}',
  true
);
do $$
declare
  v_result jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"027-secretary","role":"authenticated"}',
    true
  );
  v_result := public.create_program_invite(
    '02700000-0000-4000-8000-000000000003',
    'secretary.invite@example.edu',
    'Secretary Invite'
  );
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: PEI-4a a program secretary could not invite a student';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"027-section-leader","role":"authenticated"}',
    true
  );
  v_result := public.create_program_invite(
    '02700000-0000-4000-8000-000000000003',
    'section.leader.invite@example.edu',
    'Section Leader Invite'
  );
  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'FAIL: PEI-4b a section leader could not invite a student';
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"027-student","role":"authenticated"}',
    true
  );
  v_result := public.create_program_invite(
    '02700000-0000-4000-8000-000000000003',
    'another.student@example.edu',
    'Another Student'
  );
  if coalesce(v_result ->> 'ok', 'true') <> 'false' then
    raise exception 'FAIL: PEI-5 a student invited someone to the program';
  end if;
end
$$;

rollback;
select 'PROGRAM EMAIL INVITES PASSED' as verification_result;
