-- ============================================================================
-- RHS Music Platform — Migration 032
-- Upcoming-event email digests: preference, delivery log, recipient query
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- Why: events reach people through `notifications` (016) — an in-app bell they
-- have to open. Nothing mails them, so a rehearsal moved to Thursday is only
-- found by someone who happens to look. This migration adds the *data* half of
-- a scheduled email digest; the sending half is the `event-digest` edge
-- function, which runs on a schedule and calls the functions below.
--
--   1. `memberships.email_upcoming_events` — one boolean, per person per
--      program, default true. Email is opt-out, and it is scoped to a program
--      because a digest is ("Marching Band: Thursday's rehearsal"); a student
--      in band and orchestra can quiet one without losing the other.
--   2. `event_digest_deliveries` — the log of what was sent to whom, on which
--      day, about which events. It is the idempotency key: a scheduled run that
--      retries, overlaps, or is invoked twice sends one email, not two.
--   3. `due_event_digests()` — the recipient query. **Service-role only**, and
--      that boundary is the point of this migration: it returns email addresses,
--      and this project never exposes those to a client (016 dropped
--      `get_roster_emails()` for exactly this reason, and 027/028 keep invite
--      addresses behind the same wall). A member may read and write their own
--      preference and nothing else.
--   4. `record_event_digests()` — one batch call that records a whole run.
--   5. `set_email_upcoming_events()` — the RPC the account screen uses to opt
--      out. It only ever writes the caller's own membership, so the program id
--      is a scope rather than an identity.
--
-- No existing behaviour changes on apply: emails start going out only once the
-- edge function is deployed *and* scheduled, and the default is "on" because a
-- feature that mails nobody until everybody opts in is not a feature.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The preference: one boolean per person per program
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column if not exists email_upcoming_events boolean not null default true;

comment on column public.memberships.email_upcoming_events is
  'Whether this member receives the scheduled upcoming-events email digest for this program. Opt-out: defaults to true. Mailed at most once per day (see event_digest_deliveries).';

-- ---------------------------------------------------------------------------
-- 2. The delivery log
-- ---------------------------------------------------------------------------
create table if not exists public.event_digest_deliveries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  ensemble_id uuid not null references public.ensembles(id) on delete cascade,
  digest_date date not null,
  event_ids   uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint event_digest_deliveries_once_per_day
    unique (user_id, ensemble_id, digest_date)
);

comment on table public.event_digest_deliveries is
  'One row per (member, program, day) the scheduled event digest was emailed. The unique key makes a retried or overlapping run idempotent; event_ids records what that email announced. Service-role only — it is keyed by person and program.';

create index if not exists event_digest_deliveries_date_idx
  on public.event_digest_deliveries (digest_date);

-- Reached only through the functions below, so clients get nothing at all —
-- the same shape as `program_invites` (028) and `attendance_reminders`.
alter table public.event_digest_deliveries enable row level security;

drop policy if exists event_digest_deliveries_no_client_access
  on public.event_digest_deliveries;
create policy event_digest_deliveries_no_client_access
  on public.event_digest_deliveries
  for all to authenticated using (false) with check (false);

revoke all on table public.event_digest_deliveries from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who is owed an email, and about what
-- ---------------------------------------------------------------------------
create or replace function public.due_event_digests(
  p_digest_date date,
  p_from        timestamptz,
  p_to          timestamptz,
  p_limit       integer default 500
)
returns table (
  user_id      uuid,
  auth_user_id uuid,
  email        text,
  recipient    text,
  ensemble_id  uuid,
  program_name text,
  event_count  integer,
  events       jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id,
         u.id,
         u.email::text,
         coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), 'there')::text,
         m.ensemble_id,
         e.name::text,
         coalesce(jsonb_array_length(upcoming.events), 0),
         upcoming.events
    from public.memberships m
    join public.ensembles e on e.id = m.ensemble_id
    join public.profiles  p on p.id = m.user_id
    join auth.users       u on u.id::text = p.auth_user_id
    cross join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id',         ev.id,
                 'name',       ev.name,
                 'date',       ev.date,
                 'end_date',   ev.end_date,
                 'all_day',    ev.all_day,
                 'location',   ev.location,
                 'event_type', ev.event_type
               )
               order by ev.date, ev.name
             ) as events
        from public.events ev
       where ev.ensemble_id = m.ensemble_id
         and not ev.archived
         and ev.date >= p_from
         and ev.date <  p_to
    ) upcoming
   where m.active
     and m.email_upcoming_events
     and e.active
     and not p.deactivated
     and u.email is not null
     and u.email <> ''
     -- An unconfirmed address is not one we were given permission to use.
     and u.email_confirmed_at is not null
     -- No email for a program with nothing coming up: silence is the correct
     -- digest for an empty week.
     and upcoming.events is not null
     and not exists (
       select 1
         from public.event_digest_deliveries d
        where d.user_id = m.user_id
          and d.ensemble_id = m.ensemble_id
          and d.digest_date = p_digest_date
     )
   order by m.ensemble_id, u.email
   limit greatest(coalesce(p_limit, 500), 1);
$$;

comment on function public.due_event_digests(date, timestamptz, timestamptz, integer) is
  'Members owed an upcoming-events email for the window [p_from, p_to): active, subscribed, confirmed address, with at least one event and no delivery logged for p_digest_date. Returns email addresses, so it is service-role only — the scheduled `event-digest` edge function calls it.';

revoke all on function public.due_event_digests(date, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.due_event_digests(date, timestamptz, timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Recording a run
-- ---------------------------------------------------------------------------
create or replace function public.record_event_digests(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'record_event_digests expects a JSON array of deliveries';
  end if;

  insert into public.event_digest_deliveries (user_id, ensemble_id, digest_date, event_ids)
  select (elem ->> 'user_id')::uuid,
         (elem ->> 'ensemble_id')::uuid,
         coalesce((elem ->> 'digest_date')::date, current_date),
         coalesce(
           (select array_agg(value::uuid)
              from jsonb_array_elements_text(coalesce(elem -> 'event_ids', '[]'::jsonb)) as value),
           '{}'::uuid[]
         )
    from jsonb_array_elements(p_rows) as entry(elem)
  on conflict (user_id, ensemble_id, digest_date) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

comment on function public.record_event_digests(jsonb) is
  'Records a batch of sent event digests from a JSON array of {user_id, ensemble_id, digest_date, event_ids}. Duplicate days are ignored, so a retried run is safe. Returns the number of new rows. Service-role only.';

revoke all on function public.record_event_digests(jsonb) from public, anon, authenticated;
grant execute on function public.record_event_digests(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Opting out (and back in)
-- ---------------------------------------------------------------------------
create or replace function public.set_email_upcoming_events(
  p_ensemble uuid,
  p_enabled  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.current_profile_id();
  v_enabled boolean := coalesce(p_enabled, true);
  v_updated integer;
begin
  if v_profile is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to change your email settings.');
  end if;

  -- The caller can only ever write their own membership: the profile comes from
  -- the session and `ensemble_id` merely narrows which membership that is.
  update public.memberships
     set email_upcoming_events = v_enabled
   where user_id = v_profile
     and ensemble_id = p_ensemble
     and active;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'message', 'You are not on that program''s roster.');
  end if;

  return jsonb_build_object('ok', true, 'email_upcoming_events', v_enabled);
end
$$;

comment on function public.set_email_upcoming_events(uuid, boolean) is
  'Sets the calling member''s upcoming-events email preference for one program they are active in. Writes only the caller''s own membership row.';

revoke all on function public.set_email_upcoming_events(uuid, boolean) from public, anon;
grant execute on function public.set_email_upcoming_events(uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_default text;
begin
  -- The preference column exists, is NOT NULL and defaults to subscribed.
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'memberships'
     and column_name = 'email_upcoming_events';
  if v_default is null or v_default not like '%true%' then
    raise exception 'FAIL: memberships.email_upcoming_events missing or not defaulting to true (got %)', v_default;
  end if;

  -- The log is unreachable from a client session.
  if has_table_privilege('authenticated', 'public.event_digest_deliveries', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_digest_deliveries', 'INSERT')
     or has_table_privilege('anon', 'public.event_digest_deliveries', 'SELECT') then
    raise exception 'FAIL: a client role holds a privilege on event_digest_deliveries';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'event_digest_deliveries'
       and policyname = 'event_digest_deliveries_no_client_access'
  ) then
    raise exception 'FAIL: event_digest_deliveries_no_client_access policy missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.event_digest_deliveries'::regclass
       and conname = 'event_digest_deliveries_once_per_day'
  ) then
    raise exception 'FAIL: the once-per-day unique key is missing';
  end if;

  -- The recipient query returns email addresses: clients must not reach it.
  if has_function_privilege('authenticated',
       'public.due_event_digests(date, timestamptz, timestamptz, integer)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.due_event_digests(date, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL: a client role can execute due_event_digests()';
  end if;
  if not has_function_privilege('service_role',
       'public.due_event_digests(date, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot execute due_event_digests()';
  end if;
  if has_function_privilege('authenticated', 'public.record_event_digests(jsonb)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute record_event_digests()';
  end if;

  -- The opt-out RPC is the one thing a member may call.
  if not has_function_privilege('authenticated',
       'public.set_email_upcoming_events(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute set_email_upcoming_events()';
  end if;
  if has_function_privilege('anon',
       'public.set_email_upcoming_events(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute set_email_upcoming_events()';
  end if;

  raise notice '032 OK: digest preference is opt-out, deliveries are logged once per day, recipients and the log are service-role only, and members can set their own preference';
end
$$;
