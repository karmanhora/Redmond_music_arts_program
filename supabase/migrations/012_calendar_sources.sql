-- ============================================================================
-- RHS Music Platform — Migration 012
-- Calendar sources (Google ICS per ensemble)
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `calendar_sources` — the hardcoded ICS URL fallback in the
--      `sync_google_calendar` edge function becomes a row: one source per
--      ensemble, so adding a program's calendar is a data insert.
--   2. `sync_google_calendar_events` gains `p_calendar_source` in
--      015_ensemble_policies_and_rpcs.sql, scoping upsert/archive to that
--      source (plus the §6 bug fixes: event_type, empty-feed guard,
--      type-derived attendance requirement).
--
-- Access: RLS on, no client policies for now — the edge function and the RPC
-- reach it with the service role / SECURITY DEFINER. Staff-facing read policies,
-- if wanted, land in 015.
-- ============================================================================

create table if not exists public.calendar_sources (
  id             uuid primary key default gen_random_uuid(),
  ensemble_id    uuid not null references public.ensembles(id) on delete cascade,
  provider       text not null default 'google_ics',
  ics_url        text not null,
  name           text not null default '',
  active         boolean not null default true,
  last_synced_at timestamptz
);

comment on table public.calendar_sources is
  'Per-ensemble calendar feeds (Google ICS). Replaces the hardcoded URL fallback in the sync edge function.';

create index if not exists calendar_sources_ensemble_idx
  on public.calendar_sources (ensemble_id);

alter table public.calendar_sources enable row level security;
revoke all on table public.calendar_sources from anon;
