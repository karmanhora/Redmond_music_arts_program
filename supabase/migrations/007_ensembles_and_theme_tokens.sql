-- ============================================================================
-- RHS Music Platform — Migration 007
-- Ensembles + per-ensemble theme tokens
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `ensembles` — one row per program (band, orchestra, choir, drama, …).
--      This migration creates the table only; the single 'band' row is inserted
--      by 014_backfill_band.sql.
--   2. `ensemble_theme_tokens` — semantic design tokens (jsonb) per ensemble.
--      The token *structure* is shared; only the values differ per program, so
--      theming a new program is a data insert, never a code change.
--
-- Naming note: "ensemble" lives in the database/API only. It never appears in
-- the UI (see PLATFORM_PLAN.md §2.4 U14) — users see "band", "section", "roster".
-- ============================================================================

create table if not exists public.ensembles (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  short_name  text not null default '',
  theme_color text not null default '#2d5a1b',
  logo_url    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.ensembles is
  'One row per program (band, orchestra, choir, …). Adding a program = inserting rows; no migration, no code change.';

create table if not exists public.ensemble_theme_tokens (
  ensemble_id uuid primary key references public.ensembles(id) on delete cascade,
  tokens      jsonb not null default '{}'::jsonb
);

comment on table public.ensemble_theme_tokens is
  'Semantic design tokens per ensemble (structure shared, values differ). No raw CSS — tokens only.';

-- ---------------------------------------------------------------------------
-- Access: RLS on, no client policies. Reads go through member-aware policies
-- added in 015_ensemble_policies_and_rpcs.sql; anon never sees the program list.
-- ---------------------------------------------------------------------------
alter table public.ensembles             enable row level security;
alter table public.ensemble_theme_tokens enable row level security;

revoke all on table public.ensembles             from anon;
revoke all on table public.ensemble_theme_tokens from anon;
