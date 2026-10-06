-- ============================================================================
-- RHS Music Platform — Migration 009
-- Memberships (roles + section are per-ensemble now) + program admins
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `memberships` — the join between a person and a program. Roles move here
--      from `profiles.roles` (which today makes a director a director
--      *everywhere*) and the section moves here from `profiles.instrument`.
--      `unique (user_id, ensemble_id)` = one membership per person per program.
--   2. `program_admins` — program-level admins (across all ensembles). Table
--      only for now: no UI until a second program exists (PLATFORM_PLAN §11).
--
-- Backfill: one 'band' membership per existing profile, roles copied verbatim,
-- section resolved from the old instrument string, active = not deactivated.
-- ============================================================================

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  section_id  uuid references public.sections(id) on delete set null,
  roles       public.app_role[] not null default '{student}',
  active      boolean not null default true,
  joined_at   timestamptz not null default now(),
  unique (user_id, ensemble_id)
);

comment on table public.memberships is
  'Person ↔ program link carrying per-ensemble roles and section. Replaces profiles.roles / profiles.instrument.';

create index if not exists memberships_ensemble_idx on public.memberships (ensemble_id);
create index if not exists memberships_section_idx  on public.memberships (section_id);

create table if not exists public.program_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.program_admins is
  'Program-level admins (all ensembles). DB support only — no UI until a second program ships.';

alter table public.memberships    enable row level security;
alter table public.program_admins enable row level security;

revoke all on table public.memberships    from anon;
revoke all on table public.program_admins from anon, authenticated;
