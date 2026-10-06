-- ============================================================================
-- RHS Music Platform — Migration 008
-- Sections replace the hardcoded INSTRUMENTS constant
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `sections` — per-ensemble sections (today's INSTRUMENTS list becomes
--      rows for the band, created by 014_backfill_band.sql). A new program
--      defines its own sections as data (Violin, Viola, Cello, …).
--   2. `memberships.section_id` (migration 009) points here, replacing the
--      free-text `profiles.instrument` string match used by RLS today.
--
-- Canonical band order (Flute → Percussion) is applied by the backfill via
-- sort_order; anything unrecognized gets a section too, deterministically.
-- ============================================================================

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  unique (ensemble_id, name)
);

comment on table public.sections is
  'Per-ensemble sections (band: Flute…Percussion). Replaces the hardcoded INSTRUMENTS constant.';

create index if not exists sections_ensemble_sort_idx
  on public.sections (ensemble_id, sort_order);

alter table public.sections enable row level security;
revoke all on table public.sections from anon;
