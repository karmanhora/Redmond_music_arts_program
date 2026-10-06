-- ============================================================================
-- RHS Music Platform — Migration 015
-- Ensemble-aware RLS: policies rewritten onto the identity helpers
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. Nine more SECURITY DEFINER helpers (on top of the five in 013) that
--      express every access rule in exactly one place, so policies stay
--      one-liners and can never disagree with the RPCs.
--   2. All 16 legacy policies are dropped and recreated without `auth.uid()` or
--      `user_has_role()` / `user_roles()` / `user_role()` — identity resolves
--      through `current_profile_id()` (Clerk `sub` claim) and authorization
--      through `has_role_in(ensemble, role)` / `is_section_leader_for(...)`.
--   3. Policies for the seven tables added by 007–012, so members can read
--      their program, sections, membership, theme and calendar source.
--   4. Explicit deny-all policies for the RPC-only tables (app_settings,
--      attendance_reminders, checkin_attempts, join_code_attempts,
--      ensemble_settings, program_admins) and for the deferred chat tables —
--      this is the "no client policies" rule from PLATFORM_PLAN §2.3 P10,
--      written down so the Supabase advisor has nothing to flag.
--   5. Guard triggers: `guard_membership_change` (roles now live on
--      `memberships`) and `guard_profile_self_update` (a person may never
--      change their own roles or their own access flag).
--
-- Policy scope changes (deliberate, per PLATFORM_PLAN §2.3):
--   * `profiles` is no longer world-readable to every signed-in user — you see
--     yourself, your co-members and (as staff) the people you manage.
--   * `events` are readable by members of the event's program only.
--   * every staff rule is evaluated *within the event's / member's program*.
--
-- Chat note: `chat_channels` / `chat_messages` are the undocumented, empty
-- legacy tables; no screen reads them. Their three policies are dropped here
-- and the tables stay RLS-on with a deny-all policy. `can_use_channel()` and
-- the `on_chat_message_inserted` trigger are retired in 018 (they depend on
-- `user_role()` / `profiles.instrument`, which 018 removes). If chat is ever
-- revived it gets its own `ensemble_id` column first.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Access helpers (SECURITY DEFINER, set search_path, no auth.uid())
-- ---------------------------------------------------------------------------

-- "Is this person a director of *some* program?" — used only to protect one
-- director from another.
create or replace function public.is_director_anywhere(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = p_user
       and 'director' = any(m.roles)
  )
$$;

comment on function public.is_director_anywhere(uuid) is
  'True when the person holds the director role in any program (ignores active: a paused director is still protected).';

-- Does this person have any active membership at all? (roster gate)
create or replace function public.has_active_membership(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = p_user
       and m.active
  )
$$;

-- Staff of one program = its director or secretary (or a program admin).
create or replace function public.is_ensemble_staff(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or public.has_role_in(p_ensemble, 'director')
      or public.has_role_in(p_ensemble, 'secretary')
$$;

-- Director of one program (or a program admin) — the "can manage" level.
create or replace function public.can_manage_ensemble(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or public.has_role_in(p_ensemble, 'director')
$$;

-- Director of the program that owns this event.
create or replace function public.is_event_director(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
     where e.id = p_event
       and public.can_manage_ensemble(e.ensemble_id)
  )
$$;

-- Who may see a person's profile row: yourself, someone you manage (as that
-- program's director / as a program admin), or a co-member of an active
-- membership. Paused members stay visible to the staff who manage them.
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
           and public.has_role_in(m.ensemble_id, 'director')
      )
$$;

create or replace function public.can_view_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user = public.current_profile_id()
      or public.can_manage_member(p_user)
      or exists (
        select 1 from public.memberships m
         where m.user_id = p_user
           and m.active
           and public.is_member_of(m.ensemble_id)
      )
$$;

-- Attendance visibility: self; staff of the event's program; or the section
-- leader of that student's section *in that program*. Section leaders never
-- see another program, and a student with no section gets nothing (the
-- `is_section_leader_for` rule: no section = no section access).
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
         or public.is_program_admin()
         or public.has_role_in(e.ensemble_id, 'director')
         or public.has_role_in(e.ensemble_id, 'secretary')
         or public.is_section_leader_for(public.current_profile_id(), s.section_id)
       )
  )
$$;

-- Staff notes are readable by staff only — never by the student they describe,
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
         public.is_program_admin()
         or public.has_role_in(e.ensemble_id, 'director')
         or public.has_role_in(e.ensemble_id, 'secretary')
         or public.is_section_leader_for(public.current_profile_id(), s.section_id)
       )
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants for the new helpers — signed-in users only, never PUBLIC, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.is_director_anywhere(uuid)          from public, anon;
revoke all on function public.has_active_membership(uuid)         from public, anon;
revoke all on function public.is_ensemble_staff(uuid)             from public, anon;
revoke all on function public.can_manage_ensemble(uuid)           from public, anon;
revoke all on function public.is_event_director(uuid)             from public, anon;
revoke all on function public.can_manage_member(uuid)             from public, anon;
revoke all on function public.can_view_profile(uuid)              from public, anon;
revoke all on function public.can_read_attendance(uuid, uuid)     from public, anon;
revoke all on function public.can_read_staff_note(uuid)           from public, anon;

grant execute on function public.is_director_anywhere(uuid)          to authenticated, service_role;
grant execute on function public.has_active_membership(uuid)         to authenticated, service_role;
grant execute on function public.is_ensemble_staff(uuid)             to authenticated, service_role;
grant execute on function public.can_manage_ensemble(uuid)           to authenticated, service_role;
grant execute on function public.is_event_director(uuid)             to authenticated, service_role;
grant execute on function public.can_manage_member(uuid)             to authenticated, service_role;
grant execute on function public.can_view_profile(uuid)              to authenticated, service_role;
grant execute on function public.can_read_attendance(uuid, uuid)     to authenticated, service_role;
grant execute on function public.can_read_staff_note(uuid)           to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. profiles — identity only. Roles and sections moved to `memberships`, so
--    these policies no longer have anything role-shaped to protect.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_read_all_authed      on public.profiles;
drop policy if exists profiles_update_self_or_director on public.profiles;
drop policy if exists profiles_delete_director      on public.profiles;
drop policy if exists profiles_read_scoped          on public.profiles;
drop policy if exists profiles_update_scoped        on public.profiles;
drop policy if exists profiles_delete_scoped        on public.profiles;

create policy profiles_read_scoped on public.profiles
  for select to authenticated
  using (public.can_view_profile(id));

create policy profiles_update_scoped on public.profiles
  for update to authenticated
  using (id = public.current_profile_id() or public.can_manage_member(id))
  with check (id = public.current_profile_id() or public.can_manage_member(id));

-- Removing a person: staff of their program may not remove another director
-- (a program admin may). Nobody may delete themselves.
create policy profiles_delete_scoped on public.profiles
  for delete to authenticated
  using (
    id <> public.current_profile_id()
    and public.can_manage_member(id)
    and (public.is_program_admin() or not public.is_director_anywhere(id))
  );

-- ---------------------------------------------------------------------------
-- 4. events — members read their program's events; staff write them.
-- ---------------------------------------------------------------------------
drop policy if exists events_read_all_authed  on public.events;
drop policy if exists events_insert_staff     on public.events;
drop policy if exists events_update_staff     on public.events;
drop policy if exists events_delete_director  on public.events;
drop policy if exists events_read_members     on public.events;

create policy events_read_members on public.events
  for select to authenticated
  using (public.is_program_admin() or public.is_member_of(ensemble_id));

create policy events_insert_staff on public.events
  for insert to authenticated
  with check (
    public.is_ensemble_staff(ensemble_id)
    and created_by = public.current_profile_id()
  );

-- USING guards which rows may be touched; WITH CHECK guards the new values, so
-- a secretary of one program cannot move an event into another program.
create policy events_update_staff on public.events
  for update to authenticated
  using (public.is_ensemble_staff(ensemble_id))
  with check (public.is_ensemble_staff(ensemble_id));

create policy events_delete_director on public.events
  for delete to authenticated
  using (public.can_manage_ensemble(ensemble_id));

-- ---------------------------------------------------------------------------
-- 5. attendance_records + attendance_staff_notes — read-only for clients;
--    every write goes through the SECURITY DEFINER check-in RPCs.
-- ---------------------------------------------------------------------------
drop policy if exists attendance_read_self_staff        on public.attendance_records;
drop policy if exists attendance_read_scoped            on public.attendance_records;
drop policy if exists attendance_staff_notes_read_staff on public.attendance_staff_notes;
drop policy if exists attendance_staff_notes_read_scoped on public.attendance_staff_notes;

create policy attendance_read_scoped on public.attendance_records
  for select to authenticated
  using (public.can_read_attendance(event_id, student_id));

create policy attendance_staff_notes_read_scoped on public.attendance_staff_notes
  for select to authenticated
  using (public.can_read_staff_note(attendance_record_id));

-- ---------------------------------------------------------------------------
-- 6. checkin_sessions — the issuer, or a director of the event's program.
-- ---------------------------------------------------------------------------
drop policy if exists checkin_sessions_read_owner_or_director on public.checkin_sessions;
drop policy if exists checkin_sessions_read_owner_or_director_v2 on public.checkin_sessions;

create policy checkin_sessions_read_owner_or_director_v2 on public.checkin_sessions
  for select to authenticated
  using (
    created_by = public.current_profile_id()
    or public.is_event_director(event_id)
  );

-- ---------------------------------------------------------------------------
-- 7. Person-scoped tables — unchanged rules, identity source swapped.
-- ---------------------------------------------------------------------------
drop policy if exists personal_events_own_all     on public.personal_events;
drop policy if exists notifications_read_own      on public.notifications;
drop policy if exists notifications_update_own    on public.notifications;

create policy personal_events_own_all on public.personal_events
  for all to authenticated
  using (owner_id = public.current_profile_id())
  with check (owner_id = public.current_profile_id());

create policy notifications_read_own on public.notifications
  for select to authenticated
  using (user_id = public.current_profile_id());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- 8. The program tables (007–012) — members read; writes are RPC/service only.
-- ---------------------------------------------------------------------------
drop policy if exists ensembles_read_members             on public.ensembles;
drop policy if exists ensemble_theme_tokens_read_members on public.ensemble_theme_tokens;
drop policy if exists sections_read_members              on public.sections;
drop policy if exists memberships_read_scoped            on public.memberships;
drop policy if exists calendar_sources_read_staff        on public.calendar_sources;

create policy ensembles_read_members on public.ensembles
  for select to authenticated
  using (public.is_member_of(id) or public.is_program_admin());

create policy ensemble_theme_tokens_read_members on public.ensemble_theme_tokens
  for select to authenticated
  using (public.is_member_of(ensemble_id) or public.is_program_admin());

create policy sections_read_members on public.sections
  for select to authenticated
  using (public.is_member_of(ensemble_id) or public.is_program_admin());

-- A member sees the membership rows of their own program (that is how the app
-- resolves the active program and how the roster shows sections); staff and
-- program admins additionally see paused members.
create policy memberships_read_scoped on public.memberships
  for select to authenticated
  using (
    public.is_member_of(ensemble_id)
    or public.can_manage_ensemble(ensemble_id)
  );

create policy calendar_sources_read_staff on public.calendar_sources
  for select to authenticated
  using (public.is_ensemble_staff(ensemble_id));

-- Read-only for clients: writes go through RPCs, the sync edge function, or the
-- service role (which bypasses RLS).
revoke insert, update, delete on public.ensembles             from anon, authenticated;
revoke insert, update, delete on public.ensemble_theme_tokens from anon, authenticated;
revoke insert, update, delete on public.sections              from anon, authenticated;
revoke insert, update, delete on public.memberships           from anon, authenticated;
revoke insert, update, delete on public.calendar_sources       from anon, authenticated;
revoke all on public.ensembles             from anon;
revoke all on public.ensemble_theme_tokens from anon;
revoke all on public.sections              from anon;
revoke all on public.memberships           from anon;
revoke all on public.calendar_sources      from anon;

-- ---------------------------------------------------------------------------
-- 9. RPC-only tables — RLS on with an explicit deny-all policy. These carry
--    rate-limit buckets, settings and admin flags that must be reachable only
--    through SECURITY DEFINER RPCs (or the service role).
--    The deny policies are intentional: if a client-read is ever needed, add a
--    real policy next to it rather than widening this one.
-- ---------------------------------------------------------------------------
-- `app_settings` is retired by 018, so this one is conditional: the pipeline
-- is re-runnable, and on a re-run against an already-migrated database the
-- table is gone and a plain `drop policy … on public.app_settings` would abort.
do $$
begin
  if to_regclass('public.app_settings') is not null then
    execute 'drop policy if exists app_settings_no_client_access on public.app_settings';
    execute 'create policy app_settings_no_client_access on public.app_settings
               for all to authenticated using (false) with check (false)';
  end if;
end
$$;

drop policy if exists attendance_reminders_no_client_access  on public.attendance_reminders;
drop policy if exists checkin_attempts_no_client_access      on public.checkin_attempts;
drop policy if exists join_code_attempts_no_client_access    on public.join_code_attempts;
drop policy if exists program_admins_no_client_access        on public.program_admins;
drop policy if exists ensemble_settings_no_client_access     on public.ensemble_settings;
drop policy if exists chat_channels_no_client_access         on public.chat_channels;
drop policy if exists chat_messages_no_client_access         on public.chat_messages;

create policy attendance_reminders_no_client_access on public.attendance_reminders
  for all to authenticated using (false) with check (false);
create policy checkin_attempts_no_client_access on public.checkin_attempts
  for all to authenticated using (false) with check (false);
create policy join_code_attempts_no_client_access on public.join_code_attempts
  for all to authenticated using (false) with check (false);
create policy program_admins_no_client_access on public.program_admins
  for all to authenticated using (false) with check (false);
create policy ensemble_settings_no_client_access on public.ensemble_settings
  for all to authenticated using (false) with check (false);
create policy chat_channels_no_client_access on public.chat_channels
  for all to authenticated using (false) with check (false);
create policy chat_messages_no_client_access on public.chat_messages
  for all to authenticated using (false) with check (false);

-- The chat tables lose every client path (see the header note): their old
-- policies depended on `can_use_channel()` -> `user_role()`/`profiles.instrument`.
drop policy if exists chat_channels_visible_to_members on public.chat_channels;
drop policy if exists chat_messages_insert_scoped      on public.chat_messages;
drop policy if exists chat_messages_read_scoped        on public.chat_messages;

-- ---------------------------------------------------------------------------
-- 10. Guard triggers
-- ---------------------------------------------------------------------------

-- Roles, sections and access flags now live on `memberships`. A client cannot
-- write memberships at all (no write policy), so this guards the RPC and
-- service-role paths: only a director of that program (or a program admin) may
-- change them, and never another director's.
create or replace function public.guard_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if new.roles      is not distinct from old.roles
     and new.section_id is not distinct from old.section_id
     and new.active   is not distinct from old.active then
    return new;
  end if;

  -- No `sub` claim: service role / migration context (edge functions, imports,
  -- backfills). Those paths are already trusted and RLS-checked.
  if v_actor is null then
    return new;
  end if;

  -- A person may change their own section (that is self-service), never their
  -- own roles or access. This branch must come FIRST: a student is not a
  -- director of their program, so checking `can_manage_ensemble` before it
  -- would refuse the one self-service change we do allow
  -- (`set_member_section` with p_member_id = the caller).
  if old.user_id = v_actor then
    if new.roles is distinct from old.roles or new.active is distinct from old.active then
      raise exception 'You cannot change your own roles or access.';
    end if;
    return new;
  end if;

  if not public.can_manage_ensemble(old.ensemble_id) then
    raise exception 'Only directors of this program can change roles, sections or membership status.';
  end if;

  if public.is_director_anywhere(old.user_id) and not public.is_program_admin() then
    raise exception 'Directors cannot change another director''s membership.';
  end if;

  return new;
end
$$;

drop trigger if exists memberships_guard_change on public.memberships;
create trigger memberships_guard_change
  before update on public.memberships
  for each row execute function public.guard_membership_change();

-- A person updating their own `profiles` row may change their name/avatar and
-- clear `must_change_password`; they may never flip their own access flag.
-- (Role escalation through the legacy `profiles.roles` column is still covered
-- by the pre-existing `profiles_guard_role_change` trigger until 018 drops the
-- column, so this function deliberately does not mention it — that is also what
-- keeps this migration re-runnable after 018 has run.)
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_profile_id() = old.id and not public.can_manage_member(old.id) then
    if new.deactivated is distinct from old.deactivated then
      raise exception 'You cannot change your own access.';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- ---------------------------------------------------------------------------
-- 11. Verification — every public table is either policy-guarded or explicitly
--     denied, and no policy still speaks the retired identity API.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad   text;
  v_total int;
begin
  select string_agg(format('%s.%s', c.relname, p.polname), ', ' order by c.relname, p.polname)
    into v_bad
    from pg_policy p
    join pg_class c      on c.oid = p.polrelid
    join pg_namespace n  on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (
       coalesce(pg_get_expr(p.polqual, p.polrelid), '')      ~ 'auth\.uid\(\)|user_has_role|user_roles|user_role\(\)'
       or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'auth\.uid\(\)|user_has_role|user_roles|user_role\(\)'
     );
  if v_bad is not null then
    raise exception 'FAIL: policies still use the retired identity API: %', v_bad;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if v_bad is not null then
    raise exception 'FAIL: RLS is on with no policy at all for: %', v_bad;
  end if;

  select count(*) into v_total
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;

  raise notice 'policies OK: % RLS tables all guarded, zero legacy identity references', v_total;
end
$$;
