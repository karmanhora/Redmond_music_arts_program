-- ============================================================================
-- RHS Music Platform — Migration 030
-- Profile depth: biography + uploaded avatars in a PRIVATE storage bucket
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- WHAT. `profiles` gains two columns and the `avatars` bucket moves from
-- public-read to member-scoped access:
--
--   1. `profiles.bio`         — the optional short biography the profile page
--                               edits. Never required, capped at 500 characters.
--   2. `profiles.avatar_path` — the object path inside the `avatars` bucket for
--                               an uploaded picture (`<auth_uid>/<uuid>.webp`).
--                               `avatar_url` is kept untouched for any legacy
--                               external URL, and the app prefers the upload.
--   3. The `avatars` bucket is PRIVATE (`public = false`) with a 5 MB cap and
--      an image-only MIME allow-list. Read access is granted, per object, to
--      the staff and co-members who may already see that person's profile row
--      (`can_view_profile`), and to the owner. Writes are owner-only.
--
-- WHY PRIVATE. A student's face is personal information about a minor. The
-- previous setup (`reapply_auth_storage.sql`, written for the one-band clone)
-- made the whole bucket world-readable, which meant the only thing protecting a
-- picture was that nobody knew its unguessable path. That is not access control.
-- With `public = false` there is no anonymous URL at all: the app displays
-- pictures through short-lived signed URLs, and the signer itself is subject to
-- the same membership rules as every other read.
--
-- Signed URLs expire by design (the app asks for an hour and refreshes before
-- they lapse); the object path — not a URL — is what is stored, so a rotated
-- link never needs a database write.
--
-- Note on writes: the four policies from `reapply_auth_storage.sql` keyed on
-- `(storage.foldername(name))[1] = auth.uid()::text`. Those are dropped here and
-- recreated against `public.current_auth_id()` — the project's one identity
-- helper (021) — so the app no longer depends on `auth.uid()` anywhere.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profile columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists bio text not null default '';

alter table public.profiles add column if not exists avatar_path text not null default '';

comment on column public.profiles.bio is
  'Optional short biography (max 500 chars) edited on the profile page.';
comment on column public.profiles.avatar_path is
  'Object path in the private `avatars` bucket for an uploaded picture; empty when none.';

-- Keep the biography bounded no matter who writes it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_bio_len'
  ) then
    alter table public.profiles
      add constraint profiles_bio_len check (char_length(bio) <= 500);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Storage access helpers (SECURITY DEFINER: they read `profiles`.)
-- ---------------------------------------------------------------------------
-- The owner folder is the uploader's Supabase Auth user id, so it is stable,
-- opaque, and carries no email or name into a URL.
create or replace function public.avatar_folder_owner(p_object_name text)
returns text
language sql
immutable
as $$
  select (storage.foldername(p_object_name))[1]
$$;

comment on function public.avatar_folder_owner(text) is
  'The auth user id that owns an avatar object (its first path segment).';

-- May the caller *read* this avatar? The owner always may; everyone else must
-- already be allowed to see the owning profile row (self, co-member, or a
-- manager of that person).
create or replace function public.can_read_avatar(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.avatar_folder_owner(p_object_name) is not null
    and (
      public.avatar_folder_owner(p_object_name) = public.current_auth_id()
      or exists (
        select 1 from public.profiles p
         where p.auth_user_id = public.avatar_folder_owner(p_object_name)
           and public.can_view_profile(p.id)
      )
    )
$$;

comment on function public.can_read_avatar(text) is
  'True when the caller may read an avatar object: its owner, or someone who can already view that person''s profile.';

-- ---------------------------------------------------------------------------
-- 3. The bucket: private, 5 MB, images only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 4. Policies — RLS on, owner writes, member-scoped reads
-- ---------------------------------------------------------------------------
-- storage.objects belongs to `supabase_storage_admin` on a hosted project, and
-- the migration role is not a member of it, so ALTER TABLE there fails with
-- "must be owner of table objects". It is also unnecessary: Supabase enables RLS
-- on storage.objects already. So enable it only when it really is off (a bare
-- local database, where the migration role does own the table) — and never
-- silently: the verification block below fails if RLS ends up disabled, because
-- these policies are inert without it.
do $$
begin
  if not coalesce(
    (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    false
  ) then
    begin
      alter table storage.objects enable row level security;
    exception when insufficient_privilege then
      raise exception
        'storage.objects has row level security disabled and this role cannot enable it. Run "alter table storage.objects enable row level security;" as the table owner (supabase_storage_admin) — in the Supabase dashboard SQL editor — then re-apply 030. The avatar policies would not be enforced without it.';
    end;
  end if;
end
$$;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists avatars_read_members      on storage.objects;
drop policy if exists avatars_write_own         on storage.objects;
drop policy if exists avatars_update_own        on storage.objects;
drop policy if exists avatars_delete_own        on storage.objects;

-- No anonymous read, no unauthenticated read: a signed read of a *permitted*
-- object is the only way to see a picture.
create policy avatars_read_members
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_read_avatar(name)
  );

-- An upload may only land in the caller's own folder, so one member can never
-- overwrite, replace or delete another member's picture.
create policy avatars_write_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and public.avatar_folder_owner(name) = public.current_auth_id()
  );

create policy avatars_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.avatar_folder_owner(name) = public.current_auth_id()
  )
  with check (
    bucket_id = 'avatars'
    and public.avatar_folder_owner(name) = public.current_auth_id()
  );

create policy avatars_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.avatar_folder_owner(name) = public.current_auth_id()
  );

-- ---------------------------------------------------------------------------
-- 5. Grants — signed-in users only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.avatar_folder_owner(text) from public, anon;
revoke all on function public.can_read_avatar(text)      from public, anon;

grant execute on function public.avatar_folder_owner(text) to authenticated, service_role;
grant execute on function public.can_read_avatar(text)      to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_pub  boolean;
  v_size bigint;
  v_bad  text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('bio', 'avatar_path')
     group by table_schema
    having count(*) = 2
  ) then
    raise exception 'FAIL: profiles.bio / profiles.avatar_path were not created';
  end if;

  select public, file_size_limit into v_pub, v_size
    from storage.buckets where id = 'avatars';
  if v_pub is null then
    raise exception 'FAIL: the avatars bucket is missing';
  end if;
  if v_pub then
    raise exception 'FAIL: the avatars bucket is still public';
  end if;
  if v_size is null or v_size > 5242880 then
    raise exception 'FAIL: the avatars bucket has no 5 MB cap';
  end if;

  -- Without RLS the policies below decide nothing, so it is part of the
  -- guarantee rather than an assumption.
  if not coalesce(
    (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    false
  ) then
    raise exception 'FAIL: row level security is off on storage.objects, so the avatar policies would not be enforced';
  end if;

  -- The old world-readable policy must be gone, and the owner-write pair present.
  if exists (
    select 1 from pg_policy p
     where p.polrelid = 'storage.objects'::regclass
       and p.polname = 'avatars_public_read'
  ) then
    raise exception 'FAIL: the public avatar read policy still exists';
  end if;

  select string_agg(want.name, ', ')
    into v_bad
    from (values ('avatars_read_members'), ('avatars_write_own'), ('avatars_update_own'), ('avatars_delete_own'))
      as want(name)
   where not exists (
     select 1 from pg_policy p
      where p.polrelid = 'storage.objects'::regclass
        and p.polname = want.name
   );
  if v_bad is not null then
    raise exception 'FAIL: avatar storage policies missing: %', v_bad;
  end if;

  -- anon cannot call the helpers.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('avatar_folder_owner', 'can_read_avatar')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'FAIL: anon can execute: %', v_bad;
  end if;

  raise notice '030 OK: profiles.bio + avatar_path added; avatars bucket private with member-scoped reads and owner-only writes';
end
$$;
