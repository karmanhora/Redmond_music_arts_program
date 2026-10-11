-- ============================================================================
-- RHS Music Platform — Migration 029
-- Granular roles & capabilities (permissions, custom roles, scoped assignments)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- WHY. Until now the whole authorization layer spoke a fixed vocabulary:
-- `memberships.roles` (the `app_role` enum) plus nine SECURITY DEFINER helpers.
-- That is a *role* model — a director could not hand a secretary "just the
-- analytics" or give a section leader "just the roster", and the only thing a
-- custom role could be was a new enum value and a new policy.
--
-- This migration adds the missing layer **without replacing the role model**:
--
--   memberships.roles (system roles)  ─┐
--   user_role_assignments (custom/scoped) ─┼─►  has_permission(ensemble, code)
--   program_admins (system administrators) ─┘
--
-- `has_permission()` is the single source of truth; the capability-shaped
-- helpers (`is_ensemble_staff`, `can_manage_ensemble`, `can_manage_member`, the
-- attendance read/override gates) are re-expressed in terms of it. Their answers
-- for the four existing system roles are byte-for-byte the behavior the previous
-- migration set produced — `security_verification_v2.sql` and
-- `ensemble_isolation.sql` prove that by still passing — so nothing already
-- shipped changes meaning.
--
-- WHAT A CUSTOM ROLE CANNOT DO (deliberate, so a "role builder" can never be an
-- escalation path):
--   * it may only carry permissions marked `delegable` (no `roles.assign`,
--     `roles.revoke`, `program.manage_settings`, `profile.manage_users`,
--     `system.manage`);
--   * the actor building/assigning it must already hold every permission it
--     grants, *in that program*, and the grant is audited;
--   * `system_admin` — the `program_admins` table — can never be assigned
--     through this interface;
--   * nobody can assign a role to themselves, and the existing
--     `guard_membership_change` trigger still refuses a self role change.
--
-- REVOCATION & ACTIVE SESSIONS. Permissions are computed from the database on
-- every request (RLS predicates and RPC guards both call `has_permission()`),
-- so a revocation takes effect on the caller's *next* query — there is no
-- cached claim to expire. The frontend permission list is only used to decide
-- which controls to render; it is never a security boundary.
--
-- NOT here: any change to existing tables, columns or rows. This migration is
-- additive; the only redefinitions are function bodies (same signatures).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `permissions` — the capability catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.permissions (
  code        text primary key,
  category    text not null,
  label       text not null,
  description text not null default '',
  /** self | section | program | global — the narrowest thing it can be granted over. */
  scope       text not null default 'program'
              check (scope in ('self', 'section', 'program', 'global')),
  /**
   * Whether an authorized staff member may hand this capability to a *custom*
   * role. Sensitive capabilities stay system-role-only.
   */
  delegable   boolean not null default true,
  sort_order  integer not null default 0
);

comment on table public.permissions is
  'Capability catalogue. Roles map to permissions; effective permissions are the union across a person''s roles, evaluated per program.';

-- ---------------------------------------------------------------------------
-- 2. `roles` — system roles (one row per app_role) + per-program custom roles
-- ---------------------------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  /** System roles mirror the `app_role` enum label; null for custom roles. */
  key         text,
  /** null = system role (applies everywhere); set = custom role in one program. */
  ensemble_id uuid references public.ensembles(id) on delete cascade,
  name        text not null,
  description text not null default '',
  /** Where the role's grants may reach: program-wide, or only the holder's section. */
  scope       text not null default 'program' check (scope in ('program', 'section')),
  is_system   boolean not null default false,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint roles_shape check (
    (is_system and key is not null and ensemble_id is null)
    or (not is_system and key is null and ensemble_id is not null)
  )
);

-- Plain unique (not partial): Postgres allows many NULLs, so custom roles are
-- unaffected, and `on conflict (key)` can use it as its arbiter.
create unique index if not exists roles_key_key on public.roles (key);
create unique index if not exists roles_ensemble_name_key
  on public.roles (ensemble_id, lower(name)) where is_system = false;

comment on table public.roles is
  'System roles (mirroring app_role) plus per-program custom roles built from delegable permissions.';

create index if not exists roles_ensemble_idx on public.roles (ensemble_id);

-- ---------------------------------------------------------------------------
-- 3. `role_permissions` — the role ⇄ capability mapping
-- ---------------------------------------------------------------------------
create table if not exists public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  permission text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission)
);

comment on table public.role_permissions is
  'Which capabilities each role grants. A person''s effective permissions are the union over every role they hold in a program.';

-- ---------------------------------------------------------------------------
-- 4. `user_role_assignments` — custom/extra role grants, scoped per program
-- ---------------------------------------------------------------------------
create table if not exists public.user_role_assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references public.profiles(id) on delete set null,
  unique (user_id, ensemble_id, role_id)
);

comment on table public.user_role_assignments is
  'Extra role grants beyond memberships.roles (custom roles, scoped grants). Revoked rows are kept for the audit trail.';

create index if not exists user_role_assignments_user_idx
  on public.user_role_assignments (user_id, ensemble_id) where revoked_at is null;
create index if not exists user_role_assignments_ensemble_idx
  on public.user_role_assignments (ensemble_id);

-- ---------------------------------------------------------------------------
-- 5. `audit_logs` — who changed whose roles, when, and what it granted
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id             bigint generated always as identity primary key,
  actor_id       uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  ensemble_id    uuid references public.ensembles(id) on delete cascade,
  role_id        uuid references public.roles(id) on delete set null,
  action         text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only record of sensitive role and permission changes. Readable to staff with roles.view for their program.';

create index if not exists audit_logs_ensemble_idx on public.audit_logs (ensemble_id, created_at desc);
create index if not exists audit_logs_target_idx on public.audit_logs (target_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Seed the capability catalogue
-- ---------------------------------------------------------------------------
insert into public.permissions (code, category, label, description, scope, delegable, sort_order) values
  ('profile.view_self',                 'profile',    'View own profile',            'See your own profile details.',                                            'self',    true,  10),
  ('profile.edit_self',                 'profile',    'Edit own profile',            'Change your display name, biography and picture.',                         'self',    true,  11),
  ('profile.manage_users',              'profile',    'Manage user profiles',        'Correct another member''s profile details.',                               'program', false, 12),

  ('roster.view_program',               'roster',     'View the roster',             'See the members of this program and their sections.',                      'program', true,  20),

  ('attendance.view_self',              'attendance', 'View own attendance',         'See your own attendance record and percentage.',                           'self',    true,  30),
  ('attendance.view_section',           'attendance', 'View section attendance',     'See attendance for the members of your own section.',                      'section', true,  31),
  ('attendance.view_program',           'attendance', 'View program attendance',     'See attendance records for the whole program.',                            'program', true,  32),
  ('attendance.mark_section',           'attendance', 'Mark own section',            'Mark attendance for members of your own section only.',                    'section', true,  33),
  ('attendance.mark_present',           'attendance', 'Mark any member',             'Mark attendance for any member of the program.',                           'program', true,  34),
  ('attendance.edit_records',           'attendance', 'Edit attendance records',     'Correct or excuse an existing attendance record.',                         'program', true,  35),
  ('attendance.manage_checkin_sessions','attendance', 'Open check-in',               'Start a QR / code check-in session for an event.',                         'program', true,  36),
  ('attendance.manage_events',          'attendance', 'Manage events',               'Create and edit events for this program.',                                 'program', true,  37),
  ('attendance.manage_roster',          'attendance', 'Manage the roster',           'Add, pause and reactivate members; move sections.',                        'program', true,  38),
  ('attendance.view_staff_notes',       'attendance', 'Read staff notes',            'See the private notes staff write on attendance records.',                 'program', true,  39),

  ('events.view_program',               'events',     'View program events',         'See this program''s calendar and events.',                                 'program', true,  40),
  ('calendar.view_sources',             'calendar',   'View calendar settings',      'See connected calendar feeds for this program.',                           'program', true,  50),

  ('attendance.view_analytics',         'analytics',  'View analytics',              'See program attendance analytics and trends.',                             'program', true,  60),

  ('roles.view',                        'roles',      'View roles & capabilities',   'See the roles in this program and what they grant.',                       'program', true,  70),
  ('roles.assign',                      'roles',      'Assign roles',                'Grant a role to a member, within their own authority.',                    'program', false, 71),
  ('roles.revoke',                      'roles',      'Revoke roles',                'Remove a role from a member.',                                             'program', false, 72),

  ('program.manage_settings',           'program',    'Manage program settings',     'Join code, archiving, and other program-wide settings.',                   'program', false, 80),
  ('system.manage',                     'system',     'System administration',       'Cross-program administration. Reserved for explicit system administrators.', 'global', false, 90)
on conflict (code) do update
  set category    = excluded.category,
      label       = excluded.label,
      description = excluded.description,
      scope       = excluded.scope,
      delegable   = excluded.delegable,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 7. Seed the system roles + their capability maps
-- ---------------------------------------------------------------------------
insert into public.roles (key, name, description, scope, is_system) values
  ('student',        'Student',         'A member of the program. Sees their own record and checks in.',                 'program', true),
  ('section_leader', 'Section leader',  'Leads a section: marks and views attendance for that section only.',            'section', true),
  ('secretary',      'Secretary',       'Runs day-to-day attendance: marks anyone, manages events, no analytics.',       'program', true),
  ('director',       'Director',        'Runs the program: analytics, settings, and assigning roles.',                   'program', true),
  ('system_admin',   'System administrator', 'Cross-program administration. Assigned only through program_admins.',     'program', true)
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      scope       = excluded.scope,
      is_system   = true;

-- Replace each system role's map wholesale, so re-running never leaves a stale
-- grant behind (and a capability we retire disappears from every role).
delete from public.role_permissions rp
 using public.roles r
 where rp.role_id = r.id
   and r.is_system;

insert into public.role_permissions (role_id, permission)
select r.id, p.permission
  from public.roles r
  join (values
    ('student',        'profile.view_self'),
    ('student',        'profile.edit_self'),
    ('student',        'events.view_program'),
    ('student',        'roster.view_program'),
    ('student',        'attendance.view_self'),

    ('section_leader', 'profile.view_self'),
    ('section_leader', 'profile.edit_self'),
    ('section_leader', 'events.view_program'),
    ('section_leader', 'roster.view_program'),
    ('section_leader', 'attendance.view_self'),
    ('section_leader', 'attendance.view_section'),
    ('section_leader', 'attendance.mark_section'),
    ('section_leader', 'attendance.view_staff_notes'),
    ('section_leader', 'attendance.manage_checkin_sessions'),

    ('secretary',      'profile.view_self'),
    ('secretary',      'profile.edit_self'),
    ('secretary',      'events.view_program'),
    ('secretary',      'roster.view_program'),
    ('secretary',      'attendance.view_self'),
    ('secretary',      'attendance.view_program'),
    ('secretary',      'attendance.mark_present'),
    ('secretary',      'attendance.edit_records'),
    ('secretary',      'attendance.view_staff_notes'),
    ('secretary',      'attendance.manage_checkin_sessions'),
    ('secretary',      'attendance.manage_events'),
    ('secretary',      'calendar.view_sources'),

    ('director',       'profile.view_self'),
    ('director',       'profile.edit_self'),
    ('director',       'profile.manage_users'),
    ('director',       'events.view_program'),
    ('director',       'roster.view_program'),
    ('director',       'attendance.view_self'),
    ('director',       'attendance.view_program'),
    ('director',       'attendance.mark_present'),
    ('director',       'attendance.edit_records'),
    ('director',       'attendance.view_staff_notes'),
    ('director',       'attendance.manage_checkin_sessions'),
    ('director',       'attendance.manage_events'),
    ('director',       'attendance.manage_roster'),
    ('director',       'calendar.view_sources'),
    ('director',       'attendance.view_analytics'),
    ('director',       'roles.view'),
    ('director',       'roles.assign'),
    ('director',       'roles.revoke'),
    ('director',       'program.manage_settings'),

    ('system_admin',   'profile.view_self'),
    ('system_admin',   'profile.edit_self'),
    ('system_admin',   'profile.manage_users'),
    ('system_admin',   'events.view_program'),
    ('system_admin',   'roster.view_program'),
    ('system_admin',   'attendance.view_self'),
    ('system_admin',   'attendance.view_section'),
    ('system_admin',   'attendance.view_program'),
    ('system_admin',   'attendance.mark_section'),
    ('system_admin',   'attendance.mark_present'),
    ('system_admin',   'attendance.edit_records'),
    ('system_admin',   'attendance.view_staff_notes'),
    ('system_admin',   'attendance.manage_checkin_sessions'),
    ('system_admin',   'attendance.manage_events'),
    ('system_admin',   'attendance.manage_roster'),
    ('system_admin',   'calendar.view_sources'),
    ('system_admin',   'attendance.view_analytics'),
    ('system_admin',   'roles.view'),
    ('system_admin',   'roles.assign'),
    ('system_admin',   'roles.revoke'),
    ('system_admin',   'program.manage_settings'),
    ('system_admin',   'system.manage')
  ) as p(role_key, permission) on p.role_key = r.key
on conflict (role_id, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 8. The capability resolver
-- ---------------------------------------------------------------------------
-- The union of: every system role the caller holds in this program (including
-- the roles array on a paused membership? NO — paused membership grants
-- nothing, matching `has_role_in`), every live custom assignment, and, for a
-- system administrator, everything.
-- A program-wide capability subsumes its section-scoped counterpart: whoever
-- may mark anybody may mark their own section, and whoever may read the whole
-- program's attendance may read one section of it. The reverse never holds.
-- This is what lets a director delegate the section-leader role without having
-- to hold `attendance.mark_section` literally themselves.
create or replace function public.permission_implications(p_permission text)
returns text[]
language sql
immutable
as $$
  select case p_permission
    when 'attendance.mark_section' then array['attendance.mark_section', 'attendance.mark_present']
    when 'attendance.view_section' then array['attendance.view_section', 'attendance.view_program']
    else array[p_permission]
  end
$$;

comment on function public.permission_implications(text) is
  'The set of grants that satisfy a capability, including the broader capability that subsumes it (program-wide ⇒ section-scoped).';

create or replace function public.has_permission(p_ensemble uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- A system administrator may do anything, anywhere.
    public.is_program_admin()
    or exists (
      select 1
        from public.memberships m
        join public.roles r          on r.key = any (m.roles::text[]) and r.is_system
        join public.role_permissions rp on rp.role_id = r.id
       where m.user_id = public.current_profile_id()
         and m.ensemble_id = p_ensemble
         and m.active
         and rp.permission = any (public.permission_implications(p_permission))
    )
    or exists (
      select 1
        from public.user_role_assignments a
        join public.role_permissions rp on rp.role_id = a.role_id
        join public.roles r            on r.id = a.role_id and r.active
       where a.user_id = public.current_profile_id()
         and a.ensemble_id = p_ensemble
         and a.revoked_at is null
         and rp.permission = any (public.permission_implications(p_permission))
    )
$$;

comment on function public.has_permission(uuid, text) is
  'The caller''s effective capabilities in one program: union of system roles (memberships.roles), custom assignments and system-admin status.';

-- Is the caller allowed to delegate every capability of this role? (subset rule)
create or replace function public.can_delegate_role_permissions(p_ensemble uuid, p_role uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_program_admin()
    or (
      public.has_permission(p_ensemble, 'roles.assign')
      and not exists (
        select 1
          from public.role_permissions rp
         where rp.role_id = p_role
           and not public.has_permission(p_ensemble, rp.permission)
      )
    )
$$;

comment on function public.can_delegate_role_permissions(uuid, uuid) is
  'True when the caller holds roles.assign in the program and already holds every capability the role grants (no privilege escalation).';

-- ---------------------------------------------------------------------------
-- 9. Re-express the capability-shaped helpers on has_permission()
-- ---------------------------------------------------------------------------
-- Staff of one program = its director or secretary (or a system administrator).
create or replace function public.is_ensemble_staff(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or public.has_permission(p_ensemble, 'attendance.mark_present')
$$;

comment on function public.is_ensemble_staff(uuid) is
  'Staff of one program: a system administrator, or anyone whose effective capabilities include attendance.mark_present.';

-- Director of one program (or a system administrator) — the "can manage" level.
create or replace function public.can_manage_ensemble(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or public.has_permission(p_ensemble, 'program.manage_settings')
$$;

-- Who may see a person's profile row: yourself, someone you manage, or a
-- co-member of an active membership. Unchanged rules, capability-backed.
create or replace function public.can_manage_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or exists (
        select 1 from public.memberships m
         where m.user_id = p_user
           and public.can_manage_ensemble(m.ensemble_id)
      )
$$;

-- Attendance visibility: self; program-wide readers; or the section leader of
-- that student's section *in that program*. A custom role carrying
-- attendance.view_program reaches the whole program; attendance.view_section
-- on its own never does.
create or replace function public.can_read_attendance(p_event uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.events e
      join public.memberships s
        on s.user_id = p_student
       and s.ensemble_id = e.ensemble_id
     where e.id = p_event
       and s.active
       and (
         p_student = public.current_profile_id()
         or public.has_permission(e.ensemble_id, 'attendance.view_program')
         or public.is_section_leader_for(public.current_profile_id(), s.section_id)
       )
  )
$$;

-- Staff notes stay staff-only — never visible to the student they describe,
-- even though that student can read their own attendance record.
create or replace function public.can_read_staff_note(p_attendance_record uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.attendance_records ar
      join public.events e on e.id = ar.event_id
      join public.memberships s
        on s.user_id = ar.student_id
       and s.ensemble_id = e.ensemble_id
     where ar.id = p_attendance_record
       and ar.student_id <> public.current_profile_id()
       and (
         public.has_permission(e.ensemble_id, 'attendance.view_program')
         or public.is_section_leader_for(public.current_profile_id(), s.section_id)
       )
  )
$$;

-- ---------------------------------------------------------------------------
-- 10. Rewrite the two attendance gates onto capabilities (same signatures)
-- ---------------------------------------------------------------------------

-- `override_attendance`: program-wide markers (director/secretary, or a custom
-- role carrying attendance.mark_present) mark anyone; a section-scoped marker
-- (section_leader, or a custom role carrying attendance.mark_section) only
-- their own section.
create or replace function public.override_attendance(
  p_event_id uuid,
  p_student_id uuid,
  p_status text DEFAULT 'present',
  p_excuse_reason text DEFAULT '',
  p_staff_note text DEFAULT ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := public.current_profile_id();
  v_ensemble  uuid;
  v_record_id uuid;
  v_section   uuid;
  v_wide      boolean;
  v_scoped    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  select ensemble_id into v_ensemble from public.events where id = p_event_id;
  if v_ensemble is null then
    return jsonb_build_object('ok', false, 'message', 'Unknown event.');
  end if;

  v_wide   := public.has_permission(v_ensemble, 'attendance.mark_present');
  v_scoped := public.has_permission(v_ensemble, 'attendance.mark_section');

  if not (v_wide or v_scoped) then
    return jsonb_build_object('ok', false, 'message', 'Only staff may override attendance.');
  end if;

  -- Section scoping applies only to markers whose capability is section-wide.
  if not v_wide then
    select m.section_id into v_section
      from public.memberships m
     where m.user_id = p_student_id
       and m.ensemble_id = v_ensemble;

    if not public.is_section_leader_for(v_uid, v_section) then
      return jsonb_build_object('ok', false, 'message', 'You can only mark students in your own section.');
    end if;
  end if;

  if not exists (
    select 1 from public.memberships
     where user_id = p_student_id and ensemble_id = v_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on the roster.');
  end if;

  -- Directors don't have attendance records.
  if exists (
    select 1 from public.memberships
     where user_id = p_student_id
       and ensemble_id = v_ensemble
       and roles @> '{director}'::public.app_role[]
  ) then
    return jsonb_build_object('ok', false, 'message', 'Directors don''t have attendance records.');
  end if;

  if p_status not in ('present', 'absent', 'excused', 'late') then
    return jsonb_build_object('ok', false, 'message', 'Invalid attendance status.');
  end if;

  if p_status = 'absent' then
    delete from public.attendance_records
     where event_id = p_event_id and student_id = p_student_id;
  else
    insert into public.attendance_records (
      event_id, student_id, attended, checked_in_at, status,
      excuse_reason, is_late, marked_by
    )
    values (
      p_event_id, p_student_id,
      p_status in ('present', 'late'),
      case when p_status in ('present', 'late') then now() else null end,
      p_status,
      p_excuse_reason,
      p_status = 'late',
      v_uid
    )
    on conflict (event_id, student_id)
    do update set
      attended = excluded.attended,
      checked_in_at = case
        when excluded.status in ('present', 'late') and attendance_records.checked_in_at is null
        then now()
        else attendance_records.checked_in_at
      end,
      status = excluded.status,
      excuse_reason = excluded.excuse_reason,
      is_late = excluded.is_late,
      marked_by = v_uid
    returning id into v_record_id;

    if coalesce(btrim(p_staff_note), '') <> '' then
      insert into public.attendance_staff_notes (attendance_record_id, staff_note, created_by, updated_at)
      values (v_record_id, left(btrim(p_staff_note), 500), v_uid, now())
      on conflict (attendance_record_id)
      do update set
        staff_note = left(btrim(p_staff_note), 500),
        created_by = v_uid,
        updated_at = now();
    end if;
  end if;

  return jsonb_build_object('ok', true, 'message', 'Attendance updated.');
end
$$;

-- `start_checkin_session`: anyone whose capabilities include opening a
-- check-in for this program (director, secretary, section leader — or a custom
-- role deliberately granted that capability).
create or replace function public.start_checkin_session(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid     uuid := public.current_profile_id();
  v_event   public.events%rowtype;
  v_token   text;
  v_entry   text;
  v_expires timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to generate a code.');
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That event no longer exists.');
  end if;

  -- Capability-backed: director, secretary and section leader (as before), plus
  -- any custom role deliberately granted attendance.manage_checkin_sessions.
  if not public.has_permission(v_event.ensemble_id, 'attendance.manage_checkin_sessions') then
    return jsonb_build_object('ok', false, 'message', 'Only directors, secretaries and section leaders can generate codes.');
  end if;

  if v_event.checkin_mode = 'toggle' then
    return jsonb_build_object('ok', false, 'message', 'This event uses toggle check-in — mark attendance with the buttons on the Check-In screen.');
  end if;
  if v_event.checkin_mode = 'none' then
    return jsonb_build_object('ok', false, 'message', 'This event doesn''t collect attendance.');
  end if;
  if now() > coalesce(v_event.end_date, v_event.date + interval '24 hours') then
    return jsonb_build_object('ok', false, 'message', 'That event has already ended — check-in is closed.');
  end if;
  if now() < v_event.date - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in opens 15 minutes before the event.');
  end if;

  delete from public.checkin_sessions where event_id = p_event_id;

  v_entry := (
    select string_agg(
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), ''
    )
    from generate_series(1, 8)
  );

  insert into public.checkin_sessions (event_id, created_by, token, entry_code, expires_at)
  values (
    p_event_id,
    v_uid,
    encode(gen_random_bytes(24), 'hex'),
    v_entry,
    now() + interval '5 minutes'
  )
  returning token, entry_code, expires_at into v_token, v_entry, v_expires;

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'entry_code', v_entry,
    'expires_at', v_expires
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 10b. Analytics gates onto the capability
-- ---------------------------------------------------------------------------
-- The four analytics RPCs used to gate on `can_manage_ensemble` (director or a
-- system administrator). They now gate on `attendance.view_analytics`, which
-- every system role except the director lacks — so the behavior is identical,
-- but a custom role that was deliberately granted analytics reaches it. Only
-- the guard line changes; the bodies are carried over from 016 verbatim.
create or replace function public.can_view_analytics(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or public.has_permission(p_ensemble, 'attendance.view_analytics')
$$;

comment on function public.can_view_analytics(uuid) is
  'True when the caller may read a program''s attendance analytics.';

create or replace function public.get_student_attendance_pct(p_student_id uuid, p_ensemble uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_analytics(p_ensemble) then
    return jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.');
  end if;
  if not exists (
    select 1 from public.memberships
     where user_id = p_student_id and ensemble_id = p_ensemble
  ) then
    return jsonb_build_object('ok', false, 'message', 'That member is not on this roster.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'percentage', public.attendance_pct_for(p_ensemble, p_student_id)
  );
end
$$;

create or replace function public.get_section_attendance_stats(p_ensemble uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.can_view_analytics(p_ensemble) then
      jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
    else (
      with roster as (
        select m.user_id,
               coalesce(s.name, '') as section,
               s.sort_order
          from public.memberships m
          left join public.sections s on s.id = m.section_id
         where m.ensemble_id = p_ensemble
           and m.active
           and not ('director' = any(m.roles))
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'section', x.section,
            'member_count', x.member_count,
            'avg_attendance_pct', x.avg_attendance_pct,
            'sort_order', x.sort_order
          )
          order by x.sort_order, x.section
        ),
        '[]'::jsonb
      )
        from (
          select section,
                 sort_order,
                 count(distinct user_id) as member_count,
                 round(avg(public.attendance_pct_for(p_ensemble, user_id)), 1) as avg_attendance_pct
            from roster
           where section <> ''
           group by section, sort_order
        ) x
    )
  end
$$;

create or replace function public.get_event_attendance_summary(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when not public.can_view_analytics(e.ensemble_id) then
          jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
        else jsonb_build_object(
          'ok', true,
          'present', (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'present'),
          'late',    (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'late'),
          'excused', (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and ar.status = 'excused'),
          'absent',  (select count(*) from public.attendance_records ar
                       where ar.event_id = e.id and (ar.status = 'absent' or ar.status is null)),
          'total',   (select count(*) from public.memberships m
                       where m.ensemble_id = e.ensemble_id
                         and m.active
                         and not ('director' = any(m.roles)))
        )
      end
        from public.events e
       where e.id = p_event_id
    ),
    jsonb_build_object('ok', false, 'message', 'Unknown event.')
  )
$$;

create or replace function public.get_attendance_trend(p_ensemble uuid, p_limit integer DEFAULT 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.can_view_analytics(p_ensemble) then
      jsonb_build_object('ok', false, 'message', 'Only directors can view analytics.')
    else (
      with recent_events as (
        select e.id, e.name, e.type, e.date, e.event_type
          from public.events e
         where e.ensemble_id = p_ensemble
           and e.archived = false
           and e.attendance_requirement = 'required'
           and e.date < now()
         order by e.date desc
         limit greatest(coalesce(p_limit, 0), 0)
      ),
      event_stats as (
        select
          re.id, re.name, re.type, re.date, re.event_type,
          (select count(*) from public.memberships m
            where m.ensemble_id = p_ensemble
              and m.active
              and not ('director' = any(m.roles))) as roster_size,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.attended = true) as present_count,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.status = 'excused') as excused_count,
          (select count(*) from public.attendance_records ar
            where ar.event_id = re.id and ar.status = 'late') as late_count
        from recent_events re
      )
      select coalesce(jsonb_agg(row_to_json(es)), '[]'::jsonb) from event_stats es
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- 11. RLS on the new tables — read scoped, writes are RPC-only
-- ---------------------------------------------------------------------------
alter table public.permissions            enable row level security;
alter table public.roles                  enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.user_role_assignments  enable row level security;
alter table public.audit_logs             enable row level security;

drop policy if exists permissions_read_all on public.permissions;
create policy permissions_read_all on public.permissions
  for select to authenticated using (true);

drop policy if exists roles_read_scoped on public.roles;
create policy roles_read_scoped on public.roles
  for select to authenticated
  using (is_system or public.is_member_of(ensemble_id) or public.is_program_admin());

drop policy if exists role_permissions_read_all on public.role_permissions;
create policy role_permissions_read_all on public.role_permissions
  for select to authenticated using (true);

-- You see your own grants; staff who manage the program see everyone's.
drop policy if exists user_role_assignments_read_scoped on public.user_role_assignments;
create policy user_role_assignments_read_scoped on public.user_role_assignments
  for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.can_manage_ensemble(ensemble_id)
  );

-- Role/permission changes are visible to the staff who may make them, and to
-- the person the entry is about.
drop policy if exists audit_logs_read_scoped on public.audit_logs;
create policy audit_logs_read_scoped on public.audit_logs
  for select to authenticated
  using (
    public.is_program_admin()
    or (ensemble_id is not null and public.has_permission(ensemble_id, 'roles.view'))
    or actor_id = public.current_profile_id()
    or target_user_id = public.current_profile_id()
  );

-- No client writes anywhere: every mutation goes through a SECURITY DEFINER RPC
-- that enforces the delegation rules. Service role still bypasses RLS.
revoke all on table public.permissions            from anon, authenticated;
revoke all on table public.roles                  from anon, authenticated;
revoke all on table public.role_permissions       from anon, authenticated;
revoke all on table public.user_role_assignments  from anon, authenticated;
revoke all on table public.audit_logs             from anon, authenticated;

grant select on table public.permissions          to authenticated;
grant select on table public.roles                to authenticated;
grant select on table public.role_permissions     to authenticated;
grant select on table public.user_role_assignments to authenticated;
grant select on table public.audit_logs           to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Defense in depth: a trigger that refuses an unauthorized assignment
--     no matter which path writes the row (RPC, service role with a caller
--     JWT, or a future code path somebody forgets to guard).
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_bad   text;
begin
  -- Service role / migration context (no `sub` claim): already trusted.
  if v_actor is null then
    return new;
  end if;

  if new.user_id = v_actor then
    raise exception 'You cannot assign a role to yourself.';
  end if;

  if not public.has_permission(new.ensemble_id, 'roles.assign') then
    raise exception 'You are not authorized to assign roles in this program.';
  end if;

  if not exists (
    select 1 from public.roles r
     where r.id = new.role_id
       and r.active
       and r.is_system = false
       and r.ensemble_id = new.ensemble_id
  ) then
    raise exception 'That role is not available in this program.';
  end if;

  -- Only delegable capabilities, and only ones the actor already holds.
  select string_agg(rp.permission, ', ')
    into v_bad
    from public.role_permissions rp
    join public.permissions p on p.code = rp.permission
   where rp.role_id = new.role_id
     and (not p.delegable or not public.has_permission(new.ensemble_id, rp.permission));

  if v_bad is not null then
    raise exception 'You cannot delegate these capabilities: %', v_bad;
  end if;

  return new;
end
$$;

drop trigger if exists user_role_assignments_guard on public.user_role_assignments;
create trigger user_role_assignments_guard
  before insert or update on public.user_role_assignments
  for each row execute function public.guard_user_role_assignment();

create or replace function public.guard_role_permissions_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_role  uuid := coalesce(new.role_id, old.role_id);
  v_ens   uuid;
  v_bad   text;
begin
  if v_actor is null then
    return coalesce(new, old);  -- trusted context
  end if;

  select r.ensemble_id into v_ens from public.roles r where r.id = v_role;
  if v_ens is null then
    -- A system role's map is configuration, not a per-program grant.
    raise exception 'System role capabilities cannot be changed here.';
  end if;

  if not public.has_permission(v_ens, 'roles.assign') then
    raise exception 'You are not authorized to change roles in this program.';
  end if;

  select string_agg(rp.permission, ', ')
    into v_bad
    from public.role_permissions rp
    join public.permissions p on p.code = rp.permission
   where rp.role_id = v_role
     and (not p.delegable or not public.has_permission(v_ens, rp.permission));

  if v_bad is not null then
    raise exception 'You cannot delegate these capabilities: %', v_bad;
  end if;

  return coalesce(new, old);
end
$$;

drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard
  before insert or update on public.role_permissions
  for each row execute function public.guard_role_permissions_change();

-- ---------------------------------------------------------------------------
-- 13. Audit helper
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_action text,
  p_ensemble uuid,
  p_target uuid,
  p_role uuid,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (actor_id, target_user_id, ensemble_id, role_id, action, detail)
  values (public.current_profile_id(), p_target, p_ensemble, p_role, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

comment on function public.log_audit(text, uuid, uuid, uuid, jsonb) is
  'Append a role/permission change to audit_logs. Internal to the role RPCs; not granted to clients.';

-- ---------------------------------------------------------------------------
-- 14. RPCs the role-management interface calls
-- ---------------------------------------------------------------------------

/** My effective capabilities in one program, for the UI to render from. */
create or replace function public.my_permissions(p_ensemble uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_profile_id() is null then
      jsonb_build_object('ok', false, 'message', 'Not signed in.')
    when not (public.is_member_of(p_ensemble) or public.is_program_admin()) then
      jsonb_build_object('ok', false, 'message', 'You are not in this program.')
    else
      jsonb_build_object(
        'ok', true,
        'permissions', coalesce(
          (select jsonb_agg(p.code order by p.code)
             from public.permissions p
            where public.has_permission(p_ensemble, p.code)),
          '[]'::jsonb)
      )
  end
$$;

/**
 * Every role available in this program — system roles plus this program's
 * custom ones — with the capabilities each grants and how many people hold it.
 * Requires roles.view (so staff can read it; members cannot enumerate roles).
 */
create or replace function public.list_program_roles(p_ensemble uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles jsonb;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.is_program_admin() or public.has_permission(p_ensemble, 'roles.view')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to view roles in this program.');
  end if;

  select coalesce(jsonb_agg(entry order by entry->>'name'), '[]'::jsonb)
    into v_roles
    from (
      select jsonb_build_object(
        'id', r.id,
        'key', r.key,
        'name', r.name,
        'description', r.description,
        'scope', r.scope,
        'is_system', r.is_system,
        'active', r.active,
        'permissions', coalesce(
          (select jsonb_agg(rp.permission order by rp.permission)
             from public.role_permissions rp where rp.role_id = r.id),
          '[]'::jsonb),
        'holder_count', case
          when r.is_system then (
            select count(*) from public.memberships m
             where m.ensemble_id = p_ensemble
               and m.active
               and r.key = any (m.roles::text[])
          )
          else (
            select count(*) from public.user_role_assignments a
             where a.role_id = r.id and a.revoked_at is null
          )
        end
      ) as entry
      from public.roles r
     where r.active
       and (r.is_system or r.ensemble_id = p_ensemble)
    ) t;

  return jsonb_build_object('ok', true, 'roles', v_roles);
end
$$;

/**
 * Grant a role. A system role edits `memberships.roles`; a custom role creates
 * (or un-revokes) an assignment row. Every guard is re-checked here even though
 * triggers also enforce them — the RPC returns a readable refusal instead of an
 * exception.
 */
create or replace function public.assign_role(
  p_ensemble uuid,
  p_user uuid,
  p_role uuid,
  p_section_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_role    public.roles%rowtype;
  v_member  boolean;
  v_bad     text;
  v_target  text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  if not (public.is_program_admin() or public.has_permission(p_ensemble, 'roles.assign')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to assign roles in this program.');
  end if;

  if p_user = v_actor then
    return jsonb_build_object('ok', false, 'message', 'You cannot change your own roles.');
  end if;

  select * into v_role from public.roles where id = p_role and active;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That role no longer exists.');
  end if;

  if v_role.is_system and v_role.key = 'system_admin' then
    return jsonb_build_object('ok', false, 'message', 'System administrator access cannot be granted from here.');
  end if;

  if not v_role.is_system and v_role.key is null and v_role.ensemble_id <> p_ensemble then
    return jsonb_build_object('ok', false, 'message', 'That role belongs to a different program.');
  end if;

  select exists (
    select 1 from public.memberships
     where user_id = p_user and ensemble_id = p_ensemble and active
  ) into v_member;
  if not v_member then
    return jsonb_build_object('ok', false, 'message', 'That person is not an active member of this program.');
  end if;

  -- No privilege escalation: only capabilities the actor already holds.
  if not public.can_delegate_role_permissions(p_ensemble, p_role) then
    select string_agg(rp.permission, ', ')
      into v_bad
      from public.role_permissions rp
     where rp.role_id = p_role
       and not public.has_permission(p_ensemble, rp.permission);

    return jsonb_build_object(
      'ok', false,
      'message', format(
        'You cannot grant capabilities you do not hold yourself: %s',
        coalesce(v_bad, 'unknown')
      )
    );
  end if;

  select coalesce(nullif(display_name, ''), nullif(full_name, ''), 'this member')
    into v_target
    from public.profiles where id = p_user;

  if v_role.is_system then
    update public.memberships
       set roles = case
         when v_role.key::public.app_role = any (roles) then roles
         else roles || v_role.key::public.app_role
       end
     where user_id = p_user and ensemble_id = p_ensemble;
  else
    insert into public.user_role_assignments
      (user_id, ensemble_id, role_id, section_id, granted_by)
    values
      (p_user, p_ensemble, p_role, p_section_id, v_actor)
    on conflict (user_id, ensemble_id, role_id)
    do update set
      revoked_at = null,
      revoked_by = null,
      granted_by = v_actor,
      granted_at = now(),
      section_id = excluded.section_id;
  end if;

  perform public.log_audit('role.assign', p_ensemble, p_user, p_role,
    jsonb_build_object('role', v_role.name, 'system_role', v_role.is_system));

  return jsonb_build_object(
    'ok', true,
    'message', format('%s now has the %s role.', v_target, v_role.name)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'message', SQLERRM);
end
$$;

/** Remove a role. Refuses to leave a program without a director. */
create or replace function public.revoke_role(
  p_ensemble uuid,
  p_user uuid,
  p_role uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_role    public.roles%rowtype;
  v_target  text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  if not (public.is_program_admin() or public.has_permission(p_ensemble, 'roles.revoke')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to revoke roles in this program.');
  end if;

  if p_user = v_actor then
    return jsonb_build_object('ok', false, 'message', 'You cannot change your own roles.');
  end if;

  select * into v_role from public.roles where id = p_role;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'That role no longer exists.');
  end if;

  if v_role.is_system and v_role.key = 'system_admin' then
    return jsonb_build_object('ok', false, 'message', 'System administrator access cannot be changed from here.');
  end if;

  if not v_role.is_system and v_role.ensemble_id <> p_ensemble then
    return jsonb_build_object('ok', false, 'message', 'That role belongs to a different program.');
  end if;

  select coalesce(nullif(display_name, ''), nullif(full_name, ''), 'this member')
    into v_target
    from public.profiles where id = p_user;

  if v_role.is_system then
    if not exists (
      select 1 from public.memberships
       where user_id = p_user and ensemble_id = p_ensemble
         and v_role.key::public.app_role = any (roles)
    ) then
      return jsonb_build_object('ok', false, 'message', format('%s does not have the %s role.', v_target, v_role.name));
    end if;

    -- Never orphan a program: the last director cannot be stripped.
    if v_role.key = 'director' and (
      select count(*) from public.memberships
       where ensemble_id = p_ensemble
         and active
         and 'director' = any (roles)
    ) <= 1 then
      return jsonb_build_object('ok', false, 'message', 'This is the program''s only director — assign another director first.');
    end if;

    if exists (
      select 1 from public.memberships
       where user_id = p_user and ensemble_id = p_ensemble
         and not public.is_program_admin()
         and public.is_director_anywhere(p_user)
    ) then
      return jsonb_build_object('ok', false, 'message', 'Directors cannot change another director''s roles.');
    end if;

    update public.memberships
       set roles = case
         when array_length(array_remove(roles, v_role.key::public.app_role), 1) is null
           then '{student}'::public.app_role[]
         else array_remove(roles, v_role.key::public.app_role)
       end
     where user_id = p_user and ensemble_id = p_ensemble;
  else
    update public.user_role_assignments
       set revoked_at = now(), revoked_by = v_actor
     where user_id = p_user and ensemble_id = p_ensemble
       and role_id = p_role and revoked_at is null;
    if not found then
      return jsonb_build_object('ok', false, 'message', format('%s does not have the %s role.', v_target, v_role.name));
    end if;
  end if;

  perform public.log_audit('role.revoke', p_ensemble, p_user, p_role,
    jsonb_build_object('role', v_role.name, 'system_role', v_role.is_system));

  return jsonb_build_object('ok', true, 'message', format('Removed the %s role from %s.', v_role.name, v_target));
exception
  when others then
    return jsonb_build_object('ok', false, 'message', SQLERRM);
end
$$;

/** Create a custom role from delegable capabilities the caller already holds. */
create or replace function public.create_custom_role(
  p_ensemble uuid,
  p_name text,
  p_description text,
  p_permissions text[],
  p_scope text default 'program'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_name  text := left(btrim(coalesce(p_name, '')), 60);
  v_scope text := case when p_scope = 'section' then 'section' else 'program' end;
  v_perms text[] := coalesce(p_permissions, '{}'::text[]);
  v_bad   text;
  v_id    uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.is_program_admin() or public.has_permission(p_ensemble, 'roles.assign')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to create roles in this program.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', 'Give the role a name.');
  end if;
  if array_length(v_perms, 1) is null then
    return jsonb_build_object('ok', false, 'message', 'Choose at least one capability for this role.');
  end if;
  if (select count(*) from public.roles where ensemble_id = p_ensemble and not is_system) >= 25 then
    return jsonb_build_object('ok', false, 'message', 'This program has reached its custom-role limit.');
  end if;

  -- Unknown, non-delegable, or capabilities the caller does not hold.
  select string_agg(x.permission, ', ')
    into v_bad
    from unnest(v_perms) as x(permission)
    left join public.permissions p on p.code = x.permission
   where p.code is null
      or not p.delegable
      or not public.has_permission(p_ensemble, x.permission);

  if v_bad is not null then
    return jsonb_build_object('ok', false, 'message', format('You cannot grant these capabilities: %s', v_bad));
  end if;

  begin
    insert into public.roles (key, ensemble_id, name, description, scope, is_system, created_by)
    values (null, p_ensemble, v_name, left(btrim(coalesce(p_description, '')), 300), v_scope, false, v_actor)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'message', 'A role with that name already exists in this program.');
  end;

  insert into public.role_permissions (role_id, permission)
  select v_id, x.permission from unnest(v_perms) as x(permission)
  on conflict do nothing;

  perform public.log_audit('role.create', p_ensemble, null, v_id,
    jsonb_build_object('role', v_name, 'permissions', to_jsonb(v_perms)));

  return jsonb_build_object('ok', true, 'message', format('Created the %s role.', v_name), 'role_id', v_id);
end
$$;

/**
 * Edit a custom role. If anybody already holds it, adding capabilities requires
 * an explicit acknowledgement (`p_confirm = true`) so a role can never silently
 * gain privileges its holders were not granted.
 */
create or replace function public.update_custom_role(
  p_role uuid,
  p_name text,
  p_description text,
  p_permissions text[],
  p_scope text default 'program',
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_role     public.roles%rowtype;
  v_name     text := left(btrim(coalesce(p_name, '')), 60);
  v_scope    text := case when p_scope = 'section' then 'section' else 'program' end;
  v_perms    text[] := coalesce(p_permissions, '{}'::text[]);
  v_bad      text;
  v_holders  int;
  v_added    text[];
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  select * into v_role from public.roles where id = p_role;
  if not found or v_role.is_system then
    return jsonb_build_object('ok', false, 'message', 'Only custom roles can be edited.');
  end if;
  if not (public.is_program_admin() or public.has_permission(v_role.ensemble_id, 'roles.assign')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to edit roles in this program.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', 'Give the role a name.');
  end if;
  if array_length(v_perms, 1) is null then
    return jsonb_build_object('ok', false, 'message', 'A role needs at least one capability.');
  end if;

  select string_agg(x.permission, ', ')
    into v_bad
    from unnest(v_perms) as x(permission)
    left join public.permissions p on p.code = x.permission
   where p.code is null
      or not p.delegable
      or not public.has_permission(v_role.ensemble_id, x.permission);

  if v_bad is not null then
    return jsonb_build_object('ok', false, 'message', format('You cannot grant these capabilities: %s', v_bad));
  end if;

  select count(*) into v_holders
    from public.user_role_assignments
   where role_id = p_role and revoked_at is null;

  select array_agg(x.permission) into v_added
    from unnest(v_perms) as x(permission)
   where not exists (
     select 1 from public.role_permissions rp
      where rp.role_id = p_role and rp.permission = x.permission
   );

  if v_holders > 0 and v_added is not null and not p_confirm then
    return jsonb_build_object(
      'ok', false,
      'needs_confirmation', true,
      'holders', v_holders,
      'added', to_jsonb(v_added),
      'message', format(
        '%s people already hold this role and would gain: %s',
        v_holders, array_to_string(v_added, ', ')
      )
    );
  end if;

  update public.roles
     set name = v_name,
         description = left(btrim(coalesce(p_description, '')), 300),
         scope = v_scope
   where id = p_role;

  delete from public.role_permissions where role_id = p_role;
  insert into public.role_permissions (role_id, permission)
  select p_role, x.permission from unnest(v_perms) as x(permission)
  on conflict do nothing;

  perform public.log_audit('role.update', v_role.ensemble_id, null, p_role,
    jsonb_build_object('role', v_name, 'permissions', to_jsonb(v_perms), 'holders', v_holders));

  return jsonb_build_object('ok', true, 'message', format('Updated the %s role.', v_name));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'message', 'A role with that name already exists in this program.');
  when others then
    return jsonb_build_object('ok', false, 'message', SQLERRM);
end
$$;

/** Delete a custom role. Refuses while anybody still holds it. */
create or replace function public.delete_custom_role(p_role uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_role    public.roles%rowtype;
  v_holders int;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;

  select * into v_role from public.roles where id = p_role;
  if not found or v_role.is_system then
    return jsonb_build_object('ok', false, 'message', 'Only custom roles can be deleted.');
  end if;
  if not (public.is_program_admin() or public.has_permission(v_role.ensemble_id, 'roles.assign')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to delete roles in this program.');
  end if;

  select count(*) into v_holders
    from public.user_role_assignments
   where role_id = p_role and revoked_at is null;

  if v_holders > 0 then
    return jsonb_build_object(
      'ok', false,
      'holders', v_holders,
      'message', format('Remove this role from %s member(s) before deleting it.', v_holders)
    );
  end if;

  delete from public.roles where id = p_role;

  perform public.log_audit('role.delete', v_role.ensemble_id, null, null,
    jsonb_build_object('role', v_role.name));

  return jsonb_build_object('ok', true, 'message', format('Deleted the %s role.', v_role.name));
end
$$;

/** Recent role/permission changes in one program. */
create or replace function public.list_role_audit(p_ensemble uuid, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 200);
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Not signed in.');
  end if;
  if not (public.is_program_admin() or public.has_permission(p_ensemble, 'roles.view')) then
    return jsonb_build_object('ok', false, 'message', 'You are not authorized to view the audit history.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'entries', coalesce((
      select jsonb_agg(entry order by entry->>'created_at' desc)
        from (
          select jsonb_build_object(
            'id', l.id,
            'action', l.action,
            'created_at', l.created_at,
            'actor_name', coalesce(nullif(a.display_name, ''), nullif(a.full_name, ''), 'Unknown'),
            'target_name', nullif(coalesce(nullif(t.display_name, ''), nullif(t.full_name, '')), ''),
            'detail', l.detail
          ) as entry
          from public.audit_logs l
          left join public.profiles a on a.id = l.actor_id
          left join public.profiles t on t.id = l.target_user_id
         where l.ensemble_id = p_ensemble
         order by l.created_at desc
         limit v_limit
        ) s
    ), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 15. Grants — signed-in users only. Never PUBLIC, never anon.
-- ---------------------------------------------------------------------------
-- Trigger functions are invoked by the system, never by a client.
revoke all on function public.guard_user_role_assignment()     from public, anon, authenticated;
revoke all on function public.guard_role_permissions_change()  from public, anon, authenticated;

revoke all on function public.permission_implications(text)              from public, anon;
revoke all on function public.can_view_analytics(uuid)                   from public, anon;
revoke all on function public.has_permission(uuid, text)                 from public, anon;
revoke all on function public.can_delegate_role_permissions(uuid, uuid)  from public, anon;
revoke all on function public.log_audit(text, uuid, uuid, uuid, jsonb)   from public, anon, authenticated;
revoke all on function public.my_permissions(uuid)                       from public, anon;
revoke all on function public.list_program_roles(uuid)                   from public, anon;
revoke all on function public.assign_role(uuid, uuid, uuid, uuid)        from public, anon;
revoke all on function public.revoke_role(uuid, uuid, uuid)              from public, anon;
revoke all on function public.create_custom_role(uuid, text, text, text[], text) from public, anon;
revoke all on function public.update_custom_role(uuid, text, text, text[], text, boolean) from public, anon;
revoke all on function public.delete_custom_role(uuid)                   from public, anon;
revoke all on function public.list_role_audit(uuid, integer)             from public, anon;

grant execute on function public.permission_implications(text)             to authenticated, service_role;
grant execute on function public.can_view_analytics(uuid)                  to authenticated, service_role;
grant execute on function public.has_permission(uuid, text)                to authenticated, service_role;
grant execute on function public.can_delegate_role_permissions(uuid, uuid) to authenticated, service_role;
grant execute on function public.log_audit(text, uuid, uuid, uuid, jsonb)  to service_role;
grant execute on function public.my_permissions(uuid)                      to authenticated, service_role;
grant execute on function public.list_program_roles(uuid)                  to authenticated, service_role;
grant execute on function public.assign_role(uuid, uuid, uuid, uuid)       to authenticated, service_role;
grant execute on function public.revoke_role(uuid, uuid, uuid)             to authenticated, service_role;
grant execute on function public.create_custom_role(uuid, text, text, text[], text)     to authenticated, service_role;
grant execute on function public.update_custom_role(uuid, text, text, text[], text, boolean) to authenticated, service_role;
grant execute on function public.delete_custom_role(uuid)                  to authenticated, service_role;
grant execute on function public.list_role_audit(uuid, integer)            to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 16. Verification — the capability layer resolves, and it fails closed
-- ---------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_bad   text;
begin
  -- The catalogue and the five system roles exist.
  select count(*) into v_n from public.permissions;
  if v_n < 20 then
    raise exception 'FAIL: permission catalogue looks incomplete (% rows)', v_n;
  end if;

  select count(*) into v_n from public.roles where is_system;
  if v_n <> 5 then
    raise exception 'FAIL: expected 5 system roles, found %', v_n;
  end if;

  -- The four app_role values each map to a system role row.
  select string_agg(e.enumlabel, ', ')
    into v_bad
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'app_role'
     and not exists (select 1 from public.roles r where r.key = e.enumlabel);
  if v_bad is not null then
    raise exception 'FAIL: app_role values with no role row: %', v_bad;
  end if;

  -- Signed out, has_permission() denies.
  perform set_config('request.jwt.claims', '{}', true);
  if public.has_permission(gen_random_uuid(), 'attendance.view_analytics') then
    raise exception 'FAIL: has_permission() granted while signed out';
  end if;

  -- Sensitive capabilities are never delegable; custom roles cannot carry them.
  select string_agg(code, ', ')
    into v_bad
    from public.permissions
   where delegable and code in (
     'roles.assign', 'roles.revoke', 'program.manage_settings',
     'profile.manage_users', 'system.manage'
   );
  if v_bad is not null then
    raise exception 'FAIL: sensitive capabilities marked delegable: %', v_bad;
  end if;

  -- The role-management RPCs are not reachable by anon.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'my_permissions', 'list_program_roles', 'assign_role', 'revoke_role',
       'create_custom_role', 'update_custom_role', 'delete_custom_role', 'list_role_audit'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'FAIL: anon can execute: %', v_bad;
  end if;

  -- Every new table has RLS on and at least one policy.
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('permissions', 'roles', 'role_permissions', 'user_role_assignments', 'audit_logs')
     and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if v_bad is not null then
    raise exception 'FAIL: new tables without RLS or a policy: %', v_bad;
  end if;

  -- No client may write them directly.
  select string_agg(c.relname, ', ')
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('permissions', 'roles', 'role_permissions', 'user_role_assignments', 'audit_logs')
     and has_table_privilege('authenticated', c.oid, 'INSERT');
  if v_bad is not null then
    raise exception 'FAIL: authenticated can INSERT into: %', v_bad;
  end if;

  raise notice '029 OK: capability layer online; system roles seeded; role RPCs authenticated-only and audited';
end
$$;
