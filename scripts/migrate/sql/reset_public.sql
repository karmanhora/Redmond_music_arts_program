-- ============================================================================
-- reset_public.sql — clear the app's `public` schema objects so schema.sql can
-- be (re)applied against a project that is empty OR already partially restored.
-- This is what makes 02_restore.sh rerunnable on the same project (the cutover
-- requirement: re-run everything).
--
-- Everything in `public` goes EXCEPT public.rls_auto_enable(): that function is
-- Supabase-shipped (its ensure_rls event trigger executes it to auto-enable RLS
-- on new tables) and dropping it would cascade-drop that platform trigger.
--
-- Runs in one transaction (DO block). Safe on an empty schema.
-- TARGET: NEW only — invoked from 02_restore.sh after its confirmation gate.
-- ============================================================================

do $$
declare
  r record;
begin
  -- 1. tables / views / sequences / foreign tables (indexes, constraints,
  --    triggers and policies go with them)
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  loop
    execute format(
      'drop %s if exists public.%I cascade',
      case r.relkind
        when 'v' then 'view'
        when 'm' then 'materialized view'
        when 'S' then 'sequence'
        when 'f' then 'foreign table'
        else 'table'
      end,
      r.relname);
  end loop;

  -- 2. functions, keeping the platform's rls_auto_enable()
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname <> 'rls_auto_enable'
  loop
    execute format('drop function if exists public.%I(%s) cascade',
                   r.proname, r.args);
  end loop;

  -- 3. leftover types (enums, domains, composites)
  for r in
    select t.typname
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and t.typtype in ('e', 'c', 'd', 'r')
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;
