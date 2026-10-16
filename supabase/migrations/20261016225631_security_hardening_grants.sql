-- ============================================================================
-- 20261016225631 — least-privilege grants (security audit, Priority 2)
-- ----------------------------------------------------------------------------
-- Row Level Security already decides which ROWS each role can touch. This
-- migration removes the table and column PRIVILEGES that no policy, trigger,
-- RPC or client code path needs, so a leak in one policy cannot also become a
-- write path. Nothing a user can do in the app changes.
--
-- Named with a timestamp, not 036_, on purpose: 20261013041215 is already
-- applied to the hosted project, and a lower version would be rejected by the
-- Supabase CLI as an out-of-order migration.
--
-- Why each step is safe (verified against the live catalog, 2026-10-16):
--   * Every trigger function in public is SECURITY DEFINER, so the guards and
--     notifiers run as the owner and do not need these grants.
--   * Every RPC the client calls is SECURITY DEFINER; the revoked writes below
--     are not on any RPC's path (they are written by definer code only).
--   * The client writes only: events, notifications (read flag), personal_events
--     and profiles (presentation columns). Everything else is read-only to it.
--   * anon has no policy and no executable function anywhere in public; it was
--     holding Supabase's default ALL grant, not a decision.
-- ============================================================================

-- 1. profiles -----------------------------------------------------------------
-- profiles_update_scoped lets a person UPDATE their own row, but with no column
-- limit. `auth_user_id` binds the row to a login and `id` is the key every
-- membership points at, so a self-edit of either was a path to rebinding or
-- orphaning an identity. guard_profile_self_update only protects `deactivated`.
-- The app's only profile write (updateMyProfile) touches exactly these columns.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, display_name, avatar_url, avatar_path, bio, must_change_password)
  on table public.profiles to authenticated;

-- 2. anon ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;

-- 3. TRUNCATE ignores RLS entirely; REFERENCES and TRIGGER are never used by
--    the app. Remove them from the signed-in role everywhere.
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- 4. Writes the client never makes directly. RLS already denies most of these
--    (no INSERT/UPDATE/DELETE policy); the grant was simply wider than needed.
--    Each table here is written only by SECURITY DEFINER code.
revoke insert, update, delete on table
  public.attendance_records,
  public.attendance_staff_notes,
  public.attendance_reminders,
  public.audit_logs,
  public.calendar_sources,
  public.checkin_attempts,
  public.checkin_sessions,
  public.chat_channels,
  public.chat_messages,
  public.ensemble_settings,
  public.ensemble_theme_tokens,
  public.ensembles,
  public.event_digest_deliveries,
  public.join_code_attempts,
  public.memberships,
  public.permissions,
  public.program_admins,
  public.program_invites,
  public.role_permissions,
  public.roles,
  public.sections,
  public.signup_account_types,
  public.teacher_invitations,
  public.teacher_invite_attempts,
  public.user_role_assignments
  from authenticated;

-- notifications: the client may mark its own as read (UPDATE, kept). Creating
-- or deleting them is the notify triggers' job.
revoke insert, delete on table public.notifications from authenticated;

-- Functions are deliberately NOT changed here. has_active_membership(uuid) is a
-- policy helper that the suites assert stays executable (SEC-v2-B3), and
-- get_join_code_status(text) returns only a boolean and is tested (C1b). Both
-- are recorded in docs/SECURITY_AUDIT_2026-10.md as low-severity items.

-- 6. Verification -------------------------------------------------------------
do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'UPDATE') then
    raise exception 'hardening: authenticated can still rebind profiles.auth_user_id';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE') then
    raise exception 'hardening: authenticated can still rewrite profiles.id';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE') then
    raise exception 'hardening: authenticated lost the profile bio edit';
  end if;
  if has_table_privilege('anon', 'public.events', 'SELECT')
     or has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'hardening: anon still has table privileges';
  end if;
  if has_table_privilege('authenticated', 'public.attendance_records', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.attendance_records', 'INSERT') then
    raise exception 'hardening: authenticated still has TRUNCATE/INSERT on attendance_records';
  end if;
end $$;
