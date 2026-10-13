-- ============================================================================
-- RHS Music Platform — Migration 034
-- Pin the search_path of the four helpers that still resolved it at call time
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why: the database linter reports these four as `function_search_path_mutable`
-- (lint 0011, https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).
-- A function with no `search_path` of its own resolves every unqualified name
-- against the *caller's* path, so a role that can create objects can decide what
-- an unqualified name inside these bodies means. `alter function … set
-- search_path = ''` fixes the path for every caller.
--
-- The empty path is safe here because none of the four needs a schema lookup:
-- `generate_join_code`, `normalize_section_name` and `permission_implications`
-- use `pg_catalog` built-ins only (always searched first, path or no path), and
-- `avatar_folder_owner` already qualifies its one non-built-in call as
-- `storage.foldername`. Nothing in a body becomes ambiguous, and — because only
-- the resolution of names changes, never a value — no caller sees a different
-- answer.
--
-- None of the four is `security definer`, so this hardens the resolution rule
-- rather than closing an escalation; it is the same one-line fix for all four.
-- ============================================================================

alter function public.generate_join_code(integer) set search_path = '';
alter function public.normalize_section_name(text) set search_path = '';
alter function public.permission_implications(text) set search_path = '';
alter function public.avatar_folder_owner(text) set search_path = '';
