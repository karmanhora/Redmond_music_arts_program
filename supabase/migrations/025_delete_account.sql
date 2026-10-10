-- Keep attendance history while removing the identity and personal data
-- associated with an account.
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
         clerk_id = null,
         auth_user_id = null
   where id = v_profile_id;
end
$$;

revoke all on function public.prepare_account_deletion(text) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(text) to service_role;

comment on function public.prepare_account_deletion(text) is
  'Removes personal account data and memberships while retaining attendance under a de-identified profile. Service role only.';
