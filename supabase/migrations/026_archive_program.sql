-- Let a program's director archive and restore the program without deleting
-- its members, events, or attendance history.
create or replace function public.set_program_active(
  p_ensemble uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active boolean;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  if p_active is null then
    return jsonb_build_object('ok', false, 'message', 'Choose whether to archive or restore the program.');
  end if;

  if not public.has_role_in(p_ensemble, 'director') then
    return jsonb_build_object('ok', false, 'message', 'Only this program''s director can archive or restore it.');
  end if;

  select active
    into v_active
    from public.ensembles
   where id = p_ensemble
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'That program could not be found.');
  end if;

  if v_active is distinct from p_active then
    update public.ensembles
       set active = p_active
     where id = p_ensemble;
  end if;

  return jsonb_build_object(
    'ok', true,
    'active', p_active,
    'message', case when p_active then 'Program restored.' else 'Program archived.' end
  );
end
$$;

comment on function public.set_program_active(uuid, boolean) is
  'Archive or restore a program for its active director; keeps its membership, events, and attendance history.';

revoke all on function public.set_program_active(uuid, boolean) from public, anon;
grant execute on function public.set_program_active(uuid, boolean) to authenticated, service_role;
