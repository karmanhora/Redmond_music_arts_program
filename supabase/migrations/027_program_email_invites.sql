-- Invite a student by email and add them to the roster after they accept the
-- Supabase Auth invitation. The pending invite table is never client-readable.
create table if not exists public.program_invites (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  email text not null,
  student_name text not null,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by_auth_user_id text
);

create unique index if not exists program_invites_pending_email_key
  on public.program_invites (ensemble_id, lower(email))
  where accepted_at is null;

alter table public.program_invites enable row level security;
revoke all on public.program_invites from public, anon, authenticated;

create or replace function public.create_program_invite(
  p_ensemble uuid,
  p_email text,
  p_student_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(coalesce(p_student_name, '')), 80);
  v_program_name text;
  v_invite_id uuid;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  if not (
    public.has_role_in(p_ensemble, 'director')
    or public.has_role_in(p_ensemble, 'secretary')
    or public.has_role_in(p_ensemble, 'section_leader')
  ) then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s staff can invite students.');
  end if;

  select name into v_program_name
    from public.ensembles
   where id = p_ensemble
     and active;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'This program is archived and cannot accept new students.');
  end if;

  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'message', 'Enter a valid student email address.');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'message', 'Enter the student''s name.');
  end if;

  if exists (
    select 1
      from auth.users u
      join public.profiles p on p.auth_user_id = u.id::text
      join public.memberships m on m.user_id = p.id
     where lower(u.email) = v_email
       and m.ensemble_id = p_ensemble
       and m.active
  ) then
    return jsonb_build_object('ok', false, 'message', 'This student is already on the roster.');
  end if;

  begin
    insert into public.program_invites (ensemble_id, email, student_name, invited_by)
    values (p_ensemble, v_email, v_name, public.current_profile_id())
    returning id into v_invite_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'message', 'An invitation for this email is already pending.');
  end;

  return jsonb_build_object(
    'ok', true,
    'invite_id', v_invite_id,
    'program_name', v_program_name
  );
end
$$;

comment on function public.create_program_invite(uuid, text, text) is
  'Creates a pending email invite for an active program. Active directors, secretaries, and section leaders can invite students.';

revoke all on function public.create_program_invite(uuid, text, text) from public, anon;
grant execute on function public.create_program_invite(uuid, text, text) to authenticated, service_role;

create or replace function public.cancel_program_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.program_invites
   where id = p_invite_id
     and accepted_at is null;
end
$$;

revoke all on function public.cancel_program_invite(uuid) from public, anon, authenticated;
grant execute on function public.cancel_program_invite(uuid) to service_role;

create or replace function public.accept_pending_program_invites(
  p_auth_user_id text,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_invite record;
  v_accepted integer := 0;
begin
  if coalesce(btrim(p_auth_user_id), '') = ''
     or coalesce(btrim(p_email), '') = '' then
    return 0;
  end if;

  for v_invite in
    select i.id, i.ensemble_id, i.student_name
      from public.program_invites i
      join public.ensembles e on e.id = i.ensemble_id and e.active
     where lower(i.email) = lower(btrim(p_email))
       and i.accepted_at is null
     order by i.created_at, i.id
     for update of i
  loop
    select p.id
      into v_profile_id
      from public.profiles p
     where p.auth_user_id = p_auth_user_id;

    if v_profile_id is null then
      insert into public.profiles (id, auth_user_id, full_name, display_name)
      values (
        gen_random_uuid(),
        p_auth_user_id,
        v_invite.student_name,
        v_invite.student_name
      )
      on conflict (auth_user_id) do nothing;

      select p.id
        into v_profile_id
        from public.profiles p
       where p.auth_user_id = p_auth_user_id;
    end if;

    if v_profile_id is not null then
      insert into public.memberships as existing_membership (user_id, ensemble_id, roles, active)
      values (v_profile_id, v_invite.ensemble_id, '{student}'::public.app_role[], true)
      on conflict (user_id, ensemble_id) do update
        set active = true,
            roles = case
              when existing_membership.roles @> '{student}'::public.app_role[]
                then existing_membership.roles
              else array_append(existing_membership.roles, 'student'::public.app_role)
            end;

      update public.program_invites
         set accepted_at = now(),
             accepted_by_auth_user_id = p_auth_user_id
       where id = v_invite.id;
      v_accepted := v_accepted + 1;
    end if;
  end loop;

  return v_accepted;
end
$$;

comment on function public.accept_pending_program_invites(text, text) is
  'Accepts email invitations for a newly verified Auth account and adds it as a student. Trigger/service-role only.';

revoke all on function public.accept_pending_program_invites(text, text) from public, anon, authenticated;
grant execute on function public.accept_pending_program_invites(text, text) to service_role;

create or replace function public.accept_program_invites_on_email_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.accept_pending_program_invites(
      new.id::text,
      coalesce(new.email, '')
    );
  end if;
  return new;
end
$$;

revoke all on function public.accept_program_invites_on_email_confirmation() from public, anon, authenticated;

drop trigger if exists on_auth_user_program_invite_confirmation on auth.users;
create trigger on_auth_user_program_invite_confirmation
  after update of email_confirmed_at on auth.users
  for each row execute function public.accept_program_invites_on_email_confirmation();
