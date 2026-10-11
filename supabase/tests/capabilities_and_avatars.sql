-- ============================================================================
-- RHS Music Platform — capabilities, custom roles, audit & avatar storage
-- ============================================================================
-- requires-table: public.role_permissions
--
-- Covers the requirements migration 029 (capability layer) and 030 (profile
-- depth + private avatar bucket) introduce. Every persona is fictional and the
-- whole suite runs in ONE transaction that is ROLLED BACK — it never touches
-- real records and never weakens a live policy.
--
-- Scenarios, in the order the task lists them:
--   A  effective permissions per system role, and the union for a multi-role user
--   B  who may assign what (student/secretary/section leader refused; director
--      allowed; no self-assignment; no system_admin; no capability the actor
--      does not hold; no cross-program administration)
--   C  revocation removes the capability, and the last director is protected
--   D  custom roles: build, delegation limits, holder confirmation, analytics
--   E  direct-table abuse: no client may write roles/assignments/audit logs
--   F  a profile may be edited by its owner and by a manager, never by a peer
--   G  avatar storage: owner-only writes, member-scoped reads, no anon access
--
-- Prints CAPABILITIES AND AVATARS PASSED on success.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.role_permissions') is null then
    raise exception 'FAIL: CAP-0 role_permissions missing — apply migration 029 first';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path'
  ) then
    raise exception 'FAIL: CAP-0 profiles.avatar_path missing — apply migration 030 first';
  end if;
end
$$;

create or replace function public.cap_assert(condition boolean, label text)
returns void
language plpgsql
as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two programs: the real band, plus a second program the band director has
-- nothing to do with. Sections for the personas live in the band.
insert into public.sections (ensemble_id, name, sort_order)
select b.id, v.name, v.ord
  from (values ('Cap Violin', 601), ('Cap Trumpet', 602)) as v(name, ord)
 cross join (select id from public.ensembles where slug = 'band') b
on conflict (ensemble_id, name) do nothing;

insert into public.ensembles (id, slug, name, short_name, active)
values ('cccccccc-0000-4000-8000-0000000000aa', 'cap-orchestra', 'Cap Orchestra', 'Cap Orch', true)
on conflict (slug) do nothing;

insert into public.profiles (id, auth_user_id, full_name, display_name) values
  ('cccccccc-0000-4000-8000-000000000001', 'cap-auth-dir',    'Cap Director',   'Cap Director'),
  ('cccccccc-0000-4000-8000-000000000002', 'cap-auth-sec',    'Cap Secretary',  'Cap Secretary'),
  ('cccccccc-0000-4000-8000-000000000003', 'cap-auth-lead',   'Cap Leader',     'Cap Leader'),
  ('cccccccc-0000-4000-8000-000000000004', 'cap-auth-stu',    'Cap Student',    'Cap Student'),
  ('cccccccc-0000-4000-8000-000000000005', 'cap-auth-stu2',   'Cap Student Two','Cap Student Two'),
  ('cccccccc-0000-4000-8000-000000000006', 'cap-auth-out',    'Cap Outsider',   'Cap Outsider'),
  ('cccccccc-0000-4000-8000-000000000007', 'cap-auth-dir2',   'Cap Director 2', 'Cap Director 2'),
  ('cccccccc-0000-4000-8000-000000000008', 'cap-auth-admin',  'Cap Admin',      'Cap Admin')
on conflict (id) do nothing;

insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
select v.user_id, b.id, s.id, v.roles, true
  from (values
    ('cccccccc-0000-4000-8000-000000000001'::uuid, 'Cap Violin'::text,  '{director}'::public.app_role[]),
    ('cccccccc-0000-4000-8000-000000000002'::uuid, null::text,          '{secretary}'::public.app_role[]),
    ('cccccccc-0000-4000-8000-000000000003'::uuid, 'Cap Violin',        '{section_leader}'::public.app_role[]),
    ('cccccccc-0000-4000-8000-000000000004'::uuid, 'Cap Violin',        '{student}'::public.app_role[]),
    ('cccccccc-0000-4000-8000-000000000005'::uuid, 'Cap Trumpet',       '{student}'::public.app_role[])
  ) as v(user_id, section_name, roles)
 cross join (select id from public.ensembles where slug = 'band') b
 left join public.sections s on s.ensemble_id = b.id and s.name = v.section_name
on conflict (user_id, ensemble_id) do nothing;

-- The second program, directed by somebody the band director does not manage.
insert into public.memberships (user_id, ensemble_id, section_id, roles, active)
values ('cccccccc-0000-4000-8000-000000000007', 'cccccccc-0000-4000-8000-0000000000aa', null,
        '{director}'::public.app_role[], true)
on conflict (user_id, ensemble_id) do nothing;

-- A system administrator (program_admins), for the cross-program checks.
insert into public.program_admins (user_id) values ('cccccccc-0000-4000-8000-000000000008')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- A. Effective permissions
-- ---------------------------------------------------------------------------
do $$
declare
  v      jsonb;
  v_band uuid;
  v_sec  uuid;
  v_dir  uuid;
  v_lead uuid;
begin
  select id into v_band from public.ensembles where slug = 'band';
  select id into v_sec  from public.roles where key = 'secretary';
  select id into v_dir  from public.roles where key = 'director';
  select id into v_lead from public.roles where key = 'section_leader';

  -- A1: a student holds exactly the member-level capabilities.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert(v->>'ok' = 'true', 'A1 my_permissions answers for a member');
  perform public.cap_assert((v->'permissions') @> '["attendance.view_self","profile.edit_self"]'::jsonb,
    'A1 student holds self-service capabilities');
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.view_program","attendance.view_analytics","roles.assign","program.manage_settings"]'::jsonb),
    'A1 student holds no staff capability');
  reset role;

  -- A2: a section leader is section-scoped, never program-wide.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-lead","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert((v->'permissions') @> '["attendance.view_section","attendance.mark_section"]'::jsonb,
    'A2 section leader holds section capabilities');
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.view_program","attendance.mark_present","attendance.view_analytics"]'::jsonb),
    'A2 section leader holds no program-wide capability');
  reset role;

  -- A3: a secretary runs attendance but has no analytics and cannot assign roles.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-sec","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert((v->'permissions') @> '["attendance.view_program","attendance.mark_present","attendance.manage_events"]'::jsonb,
    'A3 secretary holds attendance capabilities');
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.view_analytics","roles.assign","program.manage_settings"]'::jsonb),
    'A3 secretary holds no director capability');
  v := public.get_section_attendance_stats(v_band);
  perform public.cap_assert(v->>'ok' = 'false', 'A3 secretary denied analytics');
  reset role;

  -- A4: a director holds the management capabilities.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert((v->'permissions') @> '["attendance.view_analytics","roles.view","roles.assign","roles.revoke","program.manage_settings"]'::jsonb,
    'A4 director holds management capabilities');
  perform public.cap_assert(not ((v->'permissions') @> '["system.manage"]'::jsonb),
    'A4 a director is not a system administrator');
  -- Success answers with a JSON *array* (the shape callRpcList reads); a refusal
  -- is the `{ok:false}` object.
  v := public.get_section_attendance_stats(v_band);
  perform public.cap_assert(jsonb_typeof(v) = 'array', 'A4 director reaches analytics');
  reset role;

  -- A5: somebody on no roster gets nothing.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-out","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert(v->>'ok' = 'false', 'A5 non-member sees no capabilities');
  reset role;

  -- A6: a multi-role member gets the *union*, and nothing more.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_lead, null);
  perform public.cap_assert(v->>'ok' = 'true', 'A6 director grants the section leader role');
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert((v->'permissions') @> '["attendance.view_self","attendance.view_section","attendance.mark_section"]'::jsonb,
    'A6 multi-role member holds the union of both roles');
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.view_analytics","roles.assign"]'::jsonb),
    'A6 multi-role member still holds no director capability');
  reset role;

  -- Back to a plain student so B starts from a known state.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  perform public.revoke_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_lead);
  reset role;

  perform set_config('request.jwt.claims', '{}', true);
end
$$;

-- ---------------------------------------------------------------------------
-- B. Who may assign what
-- ---------------------------------------------------------------------------
do $$
declare
  v      jsonb;
  v_band uuid;
  v_orch uuid;
  v_stu  uuid;
  v_sec  uuid;
  v_dir  uuid;
  v_admin uuid;
  v_rogue uuid;
begin
  select id into v_band from public.ensembles where slug = 'band';
  select id into v_orch from public.ensembles where slug = 'cap-orchestra';
  select id into v_stu  from public.roles where key = 'student';
  select id into v_sec  from public.roles where key = 'secretary';
  select id into v_dir  from public.roles where key = 'director';
  select id into v_admin from public.roles where key = 'system_admin';

  -- A rogue custom role carrying a capability no director holds. Created as the
  -- superuser (no JWT claim) so the triggers allow it — this is the fixture that
  -- proves the *assignment* path refuses to hand it out.
  insert into public.roles (id, key, ensemble_id, name, description, scope, is_system)
  values ('cccccccc-0000-4000-8000-0000000000bb', null, v_band, 'Rogue', 'system administer', 'program', false);
  insert into public.role_permissions (role_id, permission)
  values ('cccccccc-0000-4000-8000-0000000000bb', 'system.manage');
  v_rogue := 'cccccccc-0000-4000-8000-0000000000bb';

  -- B1: a student cannot assign anything, least of all to themselves.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_dir, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B1a student cannot grant themselves a role');
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_sec, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B1b student cannot grant a peer a role');
  v := public.create_custom_role(v_band, 'Student role', 'nope', array['attendance.view_analytics'], 'program');
  perform public.cap_assert(v->>'ok' = 'false', 'B1c student cannot create roles');
  reset role;
  perform public.cap_assert(
    (select count(*) from public.memberships
      where user_id = 'cccccccc-0000-4000-8000-000000000004'
        and ensemble_id = v_band
        and roles = '{student}'::public.app_role[]) = 1,
    'B1d a refused assignment changed nothing');

  -- B2: a section leader cannot assign either.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-lead","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_sec, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B2 section leader cannot assign roles');
  reset role;

  -- B3: a secretary (staff, but not a delegator) cannot assign.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-sec","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_stu, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B3 secretary cannot assign roles');
  v := public.revoke_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_stu);
  perform public.cap_assert(v->>'ok' = 'false', 'B3 secretary cannot revoke roles');
  reset role;

  -- B4: a director may assign a role within their program.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_sec, null);
  perform public.cap_assert(v->>'ok' = 'true', 'B4 director assigns a staff role');
  perform public.cap_assert(
    (select roles @> '{secretary}'::public.app_role[] from public.memberships
      where user_id = 'cccccccc-0000-4000-8000-000000000005' and ensemble_id = v_band),
    'B4 the membership carries the new role');

  -- B5: no self-assignment, even with the permission.
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000001', v_dir, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B5 a director cannot assign to themselves');

  -- B6: system administrator access is not assignable.
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_admin, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B6 system_admin cannot be granted here');

  -- B7: a capability the director does not hold cannot be delegated.
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_rogue, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B7 a capability the actor lacks cannot be granted');

  -- B8: no cross-program administration — the band director has no authority
  --     in the orchestra, and the orchestra's director none in the band.
  v := public.assign_role(v_orch, 'cccccccc-0000-4000-8000-000000000007', v_dir, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B8a band director cannot manage another program');
  v := public.create_custom_role(v_orch, 'Outside', 'no', array['attendance.view_analytics'], 'program');
  perform public.cap_assert(v->>'ok' = 'false', 'B8b band director cannot create roles in another program');
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir2","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_sec, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B8c another program''s director has no authority here');
  reset role;

  -- B9: the target must be on this program's roster.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000006', v_stu, null);
  perform public.cap_assert(v->>'ok' = 'false', 'B9 cannot assign a role to a non-member');
  reset role;

  -- B10: a system administrator may, and the change is audited.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-admin","role":"authenticated"}', true);
  set role authenticated;
  v := public.assign_role(v_orch, 'cccccccc-0000-4000-8000-000000000007', v_dir, null);
  perform public.cap_assert(v->>'ok' = 'true', 'B10 the system administrator may assign anywhere');
  reset role;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  perform public.cap_assert(
    (select count(*) from public.audit_logs
      where ensemble_id = v_band and action = 'role.assign'
        and target_user_id = 'cccccccc-0000-4000-8000-000000000005') = 1,
    'B11 the granted role left an audit entry');
  perform public.cap_assert(
    (select count(*) from public.audit_logs where ensemble_id = v_band and action = 'role.assign') >= 1,
    'B11 audit history is recorded');
end
$$;

-- ---------------------------------------------------------------------------
-- C. Revocation, and the last-director protection
-- ---------------------------------------------------------------------------
do $$
declare
  v      jsonb;
  v_band uuid;
  v_orch uuid;
  v_sec  uuid;
  v_dir  uuid;
begin
  select id into v_band from public.ensembles where slug = 'band';
  select id into v_orch from public.ensembles where slug = 'cap-orchestra';
  select id into v_sec  from public.roles where key = 'secretary';
  select id into v_dir  from public.roles where key = 'director';

  -- C1: revoking removes the capability immediately.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.revoke_role(v_band, 'cccccccc-0000-4000-8000-000000000005', v_sec);
  perform public.cap_assert(v->>'ok' = 'true', 'C1 director revokes a role');
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu2","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.mark_present","attendance.view_program"]'::jsonb),
    'C1 the revoked capability is gone from the next request');
  v := public.override_attendance(
    'eeeeeeee-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000004', 'present', '', '');
  perform public.cap_assert(v->>'ok' = 'false', 'C1 the revoked capability is enforced server-side');
  reset role;

  -- C2: a director cannot strip another director, and the last director of a
  --     program can never be removed (that would orphan the program).
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-admin","role":"authenticated"}', true);
  set role authenticated;
  v := public.revoke_role(v_orch, 'cccccccc-0000-4000-8000-000000000007', v_dir);
  perform public.cap_assert(v->>'ok' = 'false', 'C2 the last director of a program cannot be stripped');
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.revoke_role(v_band, 'cccccccc-0000-4000-8000-000000000001', v_dir);
  perform public.cap_assert(v->>'ok' = 'false', 'C2 a director cannot revoke their own role');
  reset role;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform public.cap_assert(
    (select count(*) from public.audit_logs where action = 'role.revoke') >= 1,
    'C3 revocation is audited');
end
$$;

-- ---------------------------------------------------------------------------
-- D. Custom roles
-- ---------------------------------------------------------------------------
do $$
declare
  v        jsonb;
  v_band   uuid;
  v_stu    uuid;
  v_custom uuid;
  v_list   jsonb;
  v_audit  jsonb;
begin
  select id into v_band from public.ensembles where slug = 'band';
  select id into v_stu  from public.roles where key = 'student';

  -- D1: a director builds a custom role from delegable capabilities they hold.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.create_custom_role(
    v_band, 'Attendance reader', 'Reads attendance, changes nothing',
    array['attendance.view_program', 'attendance.view_self'], 'program');
  perform public.cap_assert(v->>'ok' = 'true', 'D1 a director can create a custom role');
  v_custom := (v->>'role_id')::uuid;

  -- D2: a non-delegable capability cannot go into a custom role.
  v := public.create_custom_role(v_band, 'Super', 'no', array['roles.assign'], 'program');
  perform public.cap_assert(v->>'ok' = 'false', 'D2 roles.assign cannot be delegated');
  v := public.create_custom_role(v_band, 'Sysadmin', 'no', array['system.manage'], 'program');
  perform public.cap_assert(v->>'ok' = 'false', 'D2 system.manage cannot be delegated');
  v := public.create_custom_role(v_band, 'Nothing', 'no', array[]::text[], 'program');
  perform public.cap_assert(v->>'ok' = 'false', 'D2 a role needs at least one capability');

  -- D3: the role appears with its capabilities in the role list.
  v_list := public.list_program_roles(v_band);
  perform public.cap_assert(v_list->>'ok' = 'true', 'D3 the role list answers');
  perform public.cap_assert(
    (select count(*) from jsonb_array_elements(v_list->'roles') e
      where e->>'id' = v_custom::text
        and (e->'permissions') @> '["attendance.view_program"]'::jsonb) = 1,
    'D3 a custom role shows the capabilities it grants');

  -- D4: assigning it gives exactly those capabilities, no more.
  v := public.assign_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_custom, null);
  perform public.cap_assert(v->>'ok' = 'true', 'D4 director assigns the custom role');
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  v := public.my_permissions(v_band);
  perform public.cap_assert((v->'permissions') @> '["attendance.view_program"]'::jsonb,
    'D4 the custom capability is effective');
  perform public.cap_assert(not ((v->'permissions') @> '["attendance.mark_present","attendance.view_analytics"]'::jsonb),
    'D4 the custom role grants nothing it does not name');
  reset role;

  -- D5: adding capabilities to a role in use needs explicit confirmation, so a
  --     holder can never silently gain privileges.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  v := public.update_custom_role(
    v_custom, 'Attendance reader', 'now with marks',
    array['attendance.view_program', 'attendance.view_self', 'attendance.mark_present'], 'program');
  perform public.cap_assert(v->>'ok' = 'false' and (v->>'needs_confirmation')::boolean,
    'D5 widening a role in use requires confirmation');
  perform public.cap_assert(
    (select count(*) from public.role_permissions
      where role_id = v_custom and permission = 'attendance.mark_present') = 0,
    'D5 the refused update changed nothing');

  v := public.update_custom_role(
    v_custom, 'Attendance reader', 'now with marks',
    array['attendance.view_program', 'attendance.view_self', 'attendance.mark_present'], 'program', true);
  perform public.cap_assert(v->>'ok' = 'true', 'D5 the confirmed update applies');
  perform public.cap_assert(
    (select count(*) from public.role_permissions
      where role_id = v_custom and permission = 'attendance.mark_present') = 1,
    'D5 the confirmed capability is stored');

  -- D6: a role somebody holds cannot be deleted out from under them.
  v := public.delete_custom_role(v_custom);
  perform public.cap_assert(v->>'ok' = 'false', 'D6 a role in use cannot be deleted');

  -- D7: after revoking the assignment, the role can be deleted, and the audit
  --     history records the whole life of it.
  v := public.revoke_role(v_band, 'cccccccc-0000-4000-8000-000000000004', v_custom);
  perform public.cap_assert(v->>'ok' = 'true', 'D7 revoking a custom role works');
  v := public.delete_custom_role(v_custom);
  perform public.cap_assert(v->>'ok' = 'true', 'D7 an unused custom role can be deleted');

  v_audit := public.list_role_audit(v_band, 50);
  perform public.cap_assert(v_audit->>'ok' = 'true', 'D7 the audit history answers');
  perform public.cap_assert(
    (select count(*) from jsonb_array_elements(v_audit->'entries') e
      where e->>'action' in ('role.create', 'role.update', 'role.delete')) >= 3,
    'D7 role create/update/delete are all audited');
  reset role;

  -- D8: a secretary cannot read the ro1e list or the audit history.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-sec","role":"authenticated"}', true);
  set role authenticated;
  perform public.cap_assert((public.list_program_roles(v_band)->>'ok') = 'false',
    'D8 secretary cannot enumerate roles');
  perform public.cap_assert((public.list_role_audit(v_band, 10)->>'ok') = 'false',
    'D8 secretary cannot read the audit history');
  reset role;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end
$$;

-- ---------------------------------------------------------------------------
-- E. Direct-table abuse — the UI is not the boundary
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;

  -- E1: no client may write the role tables, even a director.
  begin
    insert into public.user_role_assignments (user_id, ensemble_id, role_id)
    values ('cccccccc-0000-4000-8000-000000000004', (select id from public.ensembles where slug = 'band'),
            (select id from public.roles where key = 'director'));
    raise exception 'FAIL: E1 a client inserted a role assignment directly';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.roles (ensemble_id, name) 
    values ((select id from public.ensembles where slug = 'band'), 'Direct');
    raise exception 'FAIL: E2 a client inserted a role directly';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.role_permissions (role_id, permission)
    values ((select id from public.roles where key = 'director'), 'system.manage');
    raise exception 'FAIL: E3 a client inserted a role permission directly';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.audit_logs (action) values ('forged');
    raise exception 'FAIL: E4 a client forged an audit entry';
  exception when insufficient_privilege then null;
  end;

  -- E5: a member cannot escalate by editing their own membership row either —
  -- the table has no client write grant at all (015 §8).
  begin
    update public.memberships set roles = '{director}'::public.app_role[]
     where user_id = 'cccccccc-0000-4000-8000-000000000004';
    raise exception 'FAIL: E5 a member rewrote their own roles';
  exception when insufficient_privilege then null;
  end;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end
$$;

-- ---------------------------------------------------------------------------
-- F. Profile editing boundaries
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- F1: a student edits their own permitted fields.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  update public.profiles set display_name = 'Cap S', bio = 'plays violin'
   where id = 'cccccccc-0000-4000-8000-000000000004';
  get diagnostics n = row_count;
  perform public.cap_assert(n = 1, 'F1 a student edits their own profile');

  -- F2: the same student cannot touch a peer's profile.
  update public.profiles set display_name = 'Hacked'
   where id = 'cccccccc-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  perform public.cap_assert(n = 0, 'F2 a student cannot edit another student''s profile');

  -- F3: a student cannot flip their own access flag.
  begin
    update public.profiles set deactivated = true
     where id = 'cccccccc-0000-4000-8000-000000000004';
    raise exception 'FAIL: F3 a student deactivated themselves';
  exception
    when raise_exception then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform public.cap_assert(
    (select not deactivated from public.profiles where id = 'cccccccc-0000-4000-8000-000000000004'),
    'F3 the access flag is intact');

  -- F4: the biography is bounded.
  begin
    update public.profiles set bio = repeat('x', 501)
     where id = 'cccccccc-0000-4000-8000-000000000004';
    raise exception 'FAIL: F4 an over-long biography was accepted';
  exception when check_violation then null;
  end;

  reset role;
  perform set_config('request.jwt.claims', '{}', true);

  -- F5: a director manages a member of their program.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-dir","role":"authenticated"}', true);
  set role authenticated;
  update public.profiles set display_name = 'Cap Student Two'
   where id = 'cccccccc-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  perform public.cap_assert(n = 1, 'F5 a director manages a member''s profile');

  -- F6: but not somebody outside their program.
  update public.profiles set display_name = 'Outside Hack'
   where id = 'cccccccc-0000-4000-8000-000000000007';
  get diagnostics n = row_count;
  perform public.cap_assert(n = 0, 'F6 a director cannot edit another program''s member');
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end
$$;

-- ---------------------------------------------------------------------------
-- G. Avatar storage — owner writes, member-scoped reads, no anonymous access
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  -- Seed one object per persona: a violin student and a trumpet student.
  insert into storage.objects (bucket_id, name, owner_id) values
    ('avatars', 'cap-auth-stu/one.webp',  'cap-auth-stu'),
    ('avatars', 'cap-auth-stu2/two.webp', 'cap-auth-stu2');

  -- G1: the owner may upload into their own folder...
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-stu","role":"authenticated"}', true);
  set role authenticated;
  insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', 'cap-auth-stu/three.webp', 'cap-auth-stu');
  perform public.cap_assert(true, 'G1 an owner can upload into their own folder');

  -- G2: ...and may not overwrite somebody else's.
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('avatars', 'cap-auth-stu2/evil.webp', 'cap-auth-stu');
    raise exception 'FAIL: G2 a member uploaded into another member''s folder';
  exception when insufficient_privilege then null;
  end;

  -- G3: deleting somebody else's object affects nothing.
  -- Supabase installs a statement-level BEFORE DELETE guard on storage.objects
  -- (storage.protect_delete) that refuses direct SQL deletes outright — even
  -- when row-level security would filter every row — so this check raised
  -- "Direct deletion from storage tables is not allowed" on a hosted project
  -- instead of deleting 0 rows. `storage.allow_delete_query` is the documented
  -- escape hatch, and it lifts only that guard: the DELETE policies from 030
  -- still decide what is actually removed, which is exactly what G3 asserts
  -- (and a missing policy would still show up here as n = 1).
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where name = 'cap-auth-stu2/two.webp';
  get diagnostics n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  perform public.cap_assert(n = 0, 'G3 a member cannot delete another member''s picture');

  -- G4: a co-member may read a picture (they can already see the profile).
  perform public.cap_assert(
    (select count(*) from storage.objects
      where name in ('cap-auth-stu/one.webp', 'cap-auth-stu2/two.webp')) >= 1,
    'G4 a co-member sees the program''s avatars');
  reset role;

  -- G5: somebody on no roster sees none of them.
  perform set_config('request.jwt.claims', '{"sub":"cap-auth-out","role":"authenticated"}', true);
  set role authenticated;
  perform public.cap_assert(
    (select count(*) from storage.objects
      where name in ('cap-auth-stu/one.webp', 'cap-auth-stu2/two.webp')) = 0,
    'G5 a non-member sees no avatars');
  reset role;

  -- G6: no anonymous read path exists at all. The bucket is private, the old
  --     world-readable policy is gone, and nothing grants `anon` (or the public
  --     pseudo-role) a permissive policy on avatar objects.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform public.cap_assert(
    (select not public from storage.buckets where id = 'avatars'),
    'G6 the avatars bucket is not public');
  perform public.cap_assert(
    not exists (
      select 1 from pg_policy p
       where p.polrelid = 'storage.objects'::regclass
         and p.polname = 'avatars_public_read'
    ),
    'G6 the world-readable avatar policy is gone');
  perform public.cap_assert(
    not exists (
      select 1 from pg_policy p
       where p.polrelid = 'storage.objects'::regclass
         and p.polname like 'avatars%'
         and (p.polroles = '{0}'::oid[]
              or exists (select 1 from unnest(p.polroles) r
                          join pg_roles pr on pr.oid = r where pr.rolname = 'anon'))
    ),
    'G6 no avatar policy is granted to anon or PUBLIC');
end
$$;

rollback;

select 'CAPABILITIES AND AVATARS PASSED' as verification_result;
