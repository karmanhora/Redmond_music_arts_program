-- ============================================================================
-- 20261016230715 — security audit F7 and F9
-- ----------------------------------------------------------------------------
-- F7: pg_net was installed in `public`, which exposes its functions through the
-- API schema. pg_net is not relocatable (ALTER EXTENSION ... SET SCHEMA is not
-- allowed), so it is dropped and recreated in `extensions`. Nothing in the
-- database calls net.http_* at the moment: cron.job is empty and the only
-- function that mentions net.http_ is Supabase's own grant_pg_net_access.
--
-- F9: profiles.clerk_id is a legacy column. All 9 rows are NULL, no policy, view,
-- index other than its own unique index, or application code reads it. The one
-- function that wrote it, prepare_account_deletion, is recreated here without
-- that assignment first, so account deletion keeps working after the drop.
-- ============================================================================

-- 1. pg_net out of public -----------------------------------------------------
-- Only when it is in public: production has it there; a fresh local database
-- does not ship pg_net at all, and then there is nothing to move.
do $$
begin
  if exists (
    select 1 from pg_extension
     where extname = 'pg_net' and extnamespace = 'public'::regnamespace
  ) then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;

-- 2. prepare_account_deletion without the clerk_id write ----------------------
-- Same body as 025_delete_account.sql except the `clerk_id = null` assignment.
-- create or replace keeps the existing grants (service_role only).
create or replace function public.prepare_account_deletion(p_auth_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
    from public.profiles
   where auth_user_id = p_auth_user_id
   for update;

  -- The Edge Function may retry after the profile was already anonymized.
  if v_profile_id is null then
    return;
  end if;

  update public.ensembles e
     set active = false
   where exists (
     select 1
       from public.memberships own_membership
      where own_membership.user_id = v_profile_id
        and own_membership.ensemble_id = e.id
        and own_membership.active
        and 'director' = any(own_membership.roles)
   )
     and not exists (
       select 1
         from public.memberships other_director
        where other_director.ensemble_id = e.id
          and other_director.user_id <> v_profile_id
          and other_director.active
          and 'director' = any(other_director.roles)
     );

  delete from public.memberships where user_id = v_profile_id;
  delete from public.program_admins where user_id = v_profile_id;
  delete from public.attendance_reminders where student_id = v_profile_id;
  delete from public.notifications where user_id = v_profile_id;
  delete from public.personal_events where owner_id = v_profile_id;
  delete from public.checkin_attempts where actor_id = v_profile_id;
  delete from public.checkin_sessions where created_by = v_profile_id;

  update public.attendance_records
     set marked_by = null
   where marked_by = v_profile_id;
  update public.attendance_staff_notes
     set created_by = null
   where created_by = v_profile_id;
  update public.events
     set created_by = null
   where created_by = v_profile_id;

  delete from public.signup_account_types
   where auth_user_id = p_auth_user_id;

  update public.profiles
     set full_name = 'Deleted account',
         display_name = 'Deleted account',
         avatar_url = '',
         must_change_password = false,
         deactivated = true,
         auth_user_id = null
   where id = v_profile_id;
end
$$;

-- 3. Drop the legacy column (its unique index goes with it) -------------------
alter table public.profiles drop column if exists clerk_id;
