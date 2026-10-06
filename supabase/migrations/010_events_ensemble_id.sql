-- ============================================================================
-- RHS Music Platform — Migration 010
-- events.ensemble_id
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- What this changes:
--   1. `events.ensemble_id` — every event belongs to a program. Added NULLABLE
--      here so existing rows stay valid; 014_backfill_band.sql assigns the band
--      to all of them and only then sets NOT NULL (verified: zero orphans).
--
-- Attendance keeps its current keys: `attendance_records`, `checkin_sessions`,
-- `attendance_staff_notes`, `checkin_attempts` and `attendance_reminders` all
-- reach their ensemble through `events.ensemble_id`. No column changes there —
-- this is exactly why "attendance keyed by event" was the right call.
-- ============================================================================

alter table public.events
  add column if not exists ensemble_id uuid
    references public.ensembles(id) on delete restrict;

create index if not exists events_ensemble_idx on public.events (ensemble_id);
