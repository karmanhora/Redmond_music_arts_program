-- ============================================================================
-- RHS Music Platform — Migration 018
-- Retire the single-ensemble legacy schema (PLATFORM_PLAN T1–T3, F1–F2)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Everything here has been superseded, in this order, by earlier migrations:
--   profiles.roles       → memberships.roles            (014 backfill, 015/016 use it)
--   profiles.instrument  → memberships.section_id       (014 backfill, 016 uses it)
--   app_settings         → ensemble_settings.join_code  (014 moved the row)
--   auth.users trigger   → Clerk `user.created` webhook (§13.2)
--   user_has_role/user_role/user_roles → 013/015 helpers
--
-- After this migration `profiles` is pure person-level identity:
--   id, clerk_id, full_name, display_name, avatar_url, must_change_password,
--   deactivated, created_at.
--
-- Ordering matters and is why this is the last migration:
--   * the 016/017 bodies had to stop reading the legacy columns first;
--   * dropping `profiles.roles` requires dropping `profiles_guard_role_change`
--     and its function first (a trigger whose body references a dropped column
--     would break every later profiles UPDATE — plpgsql bodies are not parsed
--     for dependencies);
--   * `guard_profile_self_update` (015) also mentions `old.roles`, so it is
--     recreated here in its final, column-free form.
--
-- NOT here — deferred to the cutover migration after the Clerk import (03b) has
-- populated every row: `alter table public.profiles alter column clerk_id set
-- not null`. Until then an unknown `sub` resolves to NULL and every helper
-- denies, which is the fail-closed behavior we want.
--
-- Chat: the undocumented, empty chat tables keep their deny-all policy but lose
-- their access helper (`can_use_channel`) and their notification trigger; both
-- depended on `user_role()` / `profiles.instrument`. Reviving chat means giving
-- `chat_channels` an `ensemble_id` first.
--
-- `reapply_auth_storage.sql` (part of the Phase 1 clone) recreates the
-- `on_auth_user_created` trigger; on any re-run of the pipeline this migration
-- removes it again, so the pipeline stays idempotent end to end.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The Supabase-Auth signup path is gone — Clerk owns identity now (§13)
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Role changes on profiles cannot happen any more; drop the old guard
-- ---------------------------------------------------------------------------
drop trigger if exists profiles_guard_role_change on public.profiles;
drop function if exists public.guard_role_change();

-- ---------------------------------------------------------------------------
-- 3. Retire the chat access helper + its fan-out trigger
-- ---------------------------------------------------------------------------
drop trigger if exists on_chat_message_inserted on public.chat_messages;
drop function if exists public.notify_chat_message();
drop function if exists public.can_use_channel(uuid);

-- ---------------------------------------------------------------------------
-- 4. The retired global-role API (superseded by the 013/015 helpers)
-- ---------------------------------------------------------------------------
drop function if exists public.user_has_role(public.app_role);
drop function if exists public.user_role();
drop function if exists public.user_roles();

-- ---------------------------------------------------------------------------
-- 5. `guard_profile_self_update` without the legacy `roles` column
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A person may edit their own name, display name, avatar and
  -- `must_change_password`; they may never flip their own access flag. Roles
  -- and sections live on `memberships`, guarded by `guard_membership_change`.
  if public.current_profile_id() = old.id and not public.can_manage_member(old.id) then
    if new.deactivated is distinct from old.deactivated then
      raise exception 'You cannot change your own access.';
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Drop the legacy columns + the global settings store
-- ---------------------------------------------------------------------------
alter table public.profiles drop column if exists instrument;
alter table public.profiles drop column if exists roles;

drop table if exists public.app_settings;

-- `profiles.id` used to mirror `auth.users.id` (ON DELETE CASCADE). Under Clerk
-- a profile is created by the `user.created` webhook and has no auth.users row
-- at all, so this FK would block every sign-up (§13.1: profiles.id stays the
-- schema-wide PK, it just stops being an auth row).
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- ---------------------------------------------------------------------------
-- 7. Verification — nothing legacy survives anywhere
-- ---------------------------------------------------------------------------
do $$
declare
  v_left text;
  v_n    int;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name in ('roles', 'instrument')
  ) then
    raise exception 'FAIL: legacy profiles columns still present';
  end if;

  if to_regclass('public.app_settings') is not null then
    raise exception 'FAIL: app_settings still exists';
  end if;

  select string_agg(p.proname, ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'user_has_role', 'user_role', 'user_roles',
       'handle_new_user', 'guard_role_change',
       'can_use_channel', 'notify_chat_message'
     );
  if v_left is not null then
    raise exception 'FAIL: retired functions remain: %', v_left;
  end if;

  -- No function body may still mention the retired identity API, the dropped
  -- columns or the dropped settings table.
  select string_agg(format('%s(%s)', p.proname, pg_get_function_arguments(p.oid)), ', ')
    into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'auth\.uid\(\)|user_has_role|user_role\(\)|user_roles\(\)|app_settings|instrument';
  if v_left is not null then
    raise exception 'FAIL: functions still reference retired objects: %', v_left;
  end if;

  -- Every membership survived the column drop, and every program still has its
  -- settings row.
  select string_agg(c.conname, ', ')
    into v_left
    from pg_constraint c
    join pg_class t      on t.oid = c.conrelid
    join pg_namespace n  on n.oid = t.relnamespace
    join pg_class f      on f.oid = c.confrelid
    join pg_namespace fn on fn.oid = f.relnamespace
   where n.nspname = 'public'
     and c.contype = 'f'
     and fn.nspname = 'auth';
  if v_left is not null then
    raise exception 'FAIL: public tables still reference auth schema: %', v_left;
  end if;

  select count(*) into v_n from public.memberships;
  if v_n = 0 then
    raise exception 'FAIL: memberships vanished';
  end if;

  select count(*) into v_n from public.ensembles;
  select count(*) into v_n from public.ensemble_settings;
  if v_n = 0 then
    raise exception 'FAIL: ensemble_settings vanished — join codes would be lost';
  end if;

  raise notice 'legacy retired OK: profiles is identity-only and Clerk-owned, app_settings gone, one identity API';
end
$$;
