-- ============================================================================
-- RHS Music Platform — Migration 011
-- Per-ensemble settings (RPC-only store)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `ensemble_settings` — per-program settings keyed by ensemble. Today this
--      holds `join_code`, replacing the single global
--      `app_settings['band_join_code']` row (moved by 014_backfill_band.sql;
--      `app_settings` itself is retired in 016).
--
-- Access: RLS on with NO client policies — exactly the rule `app_settings`
-- follows today (PLATFORM_PLAN §2.3 P10). Join codes are reachable only through
-- the SECURITY DEFINER RPCs, never through PostgREST directly.
-- ============================================================================

create table if not exists public.ensemble_settings (
  ensemble_id uuid primary key references public.ensembles(id) on delete cascade,
  join_code   text not null default ''
);

comment on table public.ensemble_settings is
  'Per-ensemble settings (join code). RPC-only: RLS on, no client policies, no anon/authenticated grants.';

alter table public.ensemble_settings enable row level security;

revoke all on table public.ensemble_settings from anon, authenticated;
