-- ============================================================================
-- RHS Music Platform — Migration 013
-- Identity column + ensemble-aware helper functions
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `profiles.clerk_id` — the Clerk `user_…` id (§13.1). The schema-wide PK
--      stays `profiles.id uuid`, so every existing FK keeps working untouched.
--      Added NULLABLE here; the Clerk import (03b) fills it for existing users
--      and the `user.created` webhook for new ones. NOT NULL is enforced by a
--      later migration once the import has run (see note at the bottom).
--   2. Five SECURITY DEFINER helpers that replace `user_roles()` /
--      `user_has_role()` / `user_role()` and `auth.uid()`:
--        current_profile_id()                    → profiles.id for the caller
--        is_program_admin()                      → program_admins membership
--        is_member_of(ensemble)                  → active membership
--        has_role_in(ensemble, role)             → role within that ensemble
--        is_section_leader_for(user, section)    → leader of that section
--
-- Why helpers: policies on `memberships` cannot safely query `memberships`
-- themselves (RLS recursion). SECURITY DEFINER breaks the recursion exactly the
-- way today's `user_roles()` does, and it removes any dependence on how
-- Clerk's token maps onto `auth.uid()`.
--
-- Callers resolve identity through `auth.jwt() ->> 'sub'` — the claim Clerk
-- session tokens carry — so test personas authenticate by setting
-- `request.jwt.claims.sub` to a fixture `clerk_id`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.clerk_id
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists clerk_id text;

-- Unique among non-null values (Postgres allows many NULLs in a unique index),
-- so this is safe to apply before the import has populated anything.
create unique index if not exists profiles_clerk_id_key
  on public.profiles (clerk_id);

comment on column public.profiles.clerk_id is
  'Clerk user id (user_…). Identity for RLS via current_profile_id().';

-- ---------------------------------------------------------------------------
-- 2. Identity helper: who is calling?
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.profiles p
   where p.clerk_id = (select auth.jwt() ->> 'sub')
$$;

comment on function public.current_profile_id() is
  'profiles.id of the signed-in user, resolved from the Clerk session token (sub claim).';

-- ---------------------------------------------------------------------------
-- 3. Program-level admins (across all ensembles)
-- ---------------------------------------------------------------------------
create or replace function public.is_program_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.program_admins pa
     where pa.user_id = public.current_profile_id()
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Membership + role checks, scoped to one ensemble
-- ---------------------------------------------------------------------------
create or replace function public.is_member_of(p_ensemble uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id     = public.current_profile_id()
       and m.ensemble_id = p_ensemble
       and m.active
  )
$$;

create or replace function public.has_role_in(p_ensemble uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id     = public.current_profile_id()
       and m.ensemble_id = p_ensemble
       and m.active
       and p_role = any(m.roles)
  )
$$;

-- Is p_user a section leader *of that section*? Sections belong to exactly one
-- ensemble, so matching on section_id scopes the check implicitly — a leader of
-- "Violin" in one program gets nothing for a same-named section in another.
create or replace function public.is_section_leader_for(p_user uuid, p_section uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_section is not null and exists (
    select 1 from public.memberships m
     where m.user_id    = p_user
       and m.section_id = p_section
       and m.active
       and 'section_leader' = any(m.roles)
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants — signed-in users only. Never PUBLIC, never anon.
-- ---------------------------------------------------------------------------
revoke all on function public.current_profile_id()                from public, anon;
revoke all on function public.is_program_admin()                  from public, anon;
revoke all on function public.is_member_of(uuid)                  from public, anon;
revoke all on function public.has_role_in(uuid, public.app_role)  from public, anon;
revoke all on function public.is_section_leader_for(uuid, uuid)   from public, anon;

grant execute on function public.current_profile_id()                to authenticated, service_role;
grant execute on function public.is_program_admin()                  to authenticated, service_role;
grant execute on function public.is_member_of(uuid)                  to authenticated, service_role;
grant execute on function public.has_role_in(uuid, public.app_role)  to authenticated, service_role;
grant execute on function public.is_section_leader_for(uuid, uuid)   to authenticated, service_role;

-- NOTE — deferred NOT NULL: `alter table public.profiles alter column clerk_id
-- set not null` belongs in the cutover migration *after* 03b has populated every
-- row (an import failure must not leave the schema unable to accept a login).
-- Until then, an unknown `sub` simply resolves to NULL and every helper denies.
