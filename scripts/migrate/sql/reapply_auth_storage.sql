-- ============================================================================
-- reapply_auth_storage.sql — idempotent custom objects that live OUTSIDE the
-- public schema and may be missed by a schema-only restore ordering.
-- ----------------------------------------------------------------------------
-- Copied verbatim (behavior-preserving) from the live app's supabase/schema.sql
-- so the Phase 1 clone is faithful. Phase 2 replaces the signup trigger with
-- the Clerk webhook flow (docs/PLATFORM_PLAN.md §13) — until then this file is
-- the repair path for:
--   * public.handle_new_user + the on_auth_user_created trigger on auth.users
--     (join-code-gated self-signup creates the profiles row)
--   * the avatars storage bucket + its four storage.objects policies
-- Run with: psql "$NEW_DB_URL" -f scripts/migrate/sql/reapply_auth_storage.sql
-- Applied automatically by 03_auth_storage.sh --apply.
-- ============================================================================

-- 1. Signup trigger (join-code gate) -----------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_join_code text;
  v_provided  text;
begin
  if coalesce(new.raw_app_meta_data ->> 'invited_by_director', 'false') = 'true' then
    insert into public.profiles (id, full_name, display_name, instrument)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', ''),
      coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
      coalesce(new.raw_user_meta_data ->> 'instrument', '')
    );
    return new;
  end if;

  v_join_code := coalesce(
    (select value from public.app_settings where key = 'band_join_code'),
    ''
  );
  if v_join_code <> '' then
    v_provided := coalesce(new.raw_user_meta_data ->> 'band_join_code', '');
    if upper(v_provided) <> upper(v_join_code) then
      return new; -- no profile → not on the roster
    end if;
  end if;

  insert into public.profiles (id, full_name, display_name, instrument)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'instrument', '')
  );
  return new;
exception
  when others then
    -- never let an auth insert die because of the profile row
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Avatars bucket + storage policies ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
