-- ============================================================================
-- RHS Music Platform — Migration 035
-- Teacher/director registration by invitation code
-- ============================================================================
-- Idempotent — safe to re-run.
--
-- WHY. Until now the only thing standing between anybody who signed up and the
-- ability to start their own program was the self-declared answer to "are you a
-- student or a teacher?" at sign-up (023/024). That answer is honest but it is
-- not a credential: it granted `create_program()` to anyone willing to tick the
-- teacher box, and there was no way for a school to issue (let alone withdraw)
-- "you may teach here".
--
-- This migration adds a real, revocable credential:
--
--   teacher_invitations       one row per issued code. Only its SHA-256 digest
--                             is stored — never the code itself.
--   teacher_invite_attempts   failed redemption attempts, for rate limiting.
--   redeem_teacher_invitation()  the only way a code becomes access.
--   has_teacher_access()      the gate `create_program()` now asks.
--
-- WHAT A CODE DOES, AND WHAT IT DOES NOT. Redeeming a valid code makes the
-- *account* a verified teacher: it may start a program of its own and becomes
-- that program's director, exactly as a self-declared teacher could before. It
-- changes nothing else about the account — no stored type is rewritten, and it
-- grants nothing on anybody else's roster. Director, secretary and section
-- leader are per-program roles in `memberships`/`user_role_assignments`, and no
-- code here mints one — so this can never be used to promote yourself into an
-- existing program.
--
-- WHY THIS CANNOT BE FORGED FROM THE BROWSER:
--   * Codes are stored hashed and validated in a SECURITY DEFINER function. The
--     hash is not a password-equivalent the client ever holds; a client that
--     knows a code can only *ask* the server to redeem it.
--   * Redemption is a single atomic UPDATE guarded by `redeemed_at is null`, so
--     two simultaneous attempts cannot both win, and a partial unique index
--     stops one account holding two live redemptions.
--   * Nothing on the account itself can be flipped into a credential: the
--     redeemed invitation row is the only record, and `signup_account_types`
--     (which is immutable to clients, 024) is not consulted for it.
--   * `create_program()` no longer trusts the declared type at all — it asks
--     `has_teacher_access()`, which reads the redeemed invitation rows.
--   * Failed attempts are rate-limited per account and per address, and a
--     successful redemption clears them.
--
-- ONE AUTHORITY. There is deliberately no second "is a teacher" flag on the
-- account. `has_teacher_access()` is the whole of it, so it cannot drift out of
-- step with the row it is derived from, and revoking the invitation takes the
-- access back on the holder's next request.
--
-- BACKWARD COMPATIBILITY. An account a migration cannot see — an existing
-- director — keeps the ability 023 already gave it, so nobody who was running a
-- program is locked out. Every other path to `create_program()` now requires a
-- redeemed invitation. Existing rosters, attendance, events, check-in and
-- student joins are untouched: this migration adds two tables and replaces two
-- function bodies, and changes no existing table, column, row or policy.
--
-- OPERATOR NOTE. The seeded initial invitation (below) is deliberately
-- **unbound** and **non-expiring**, because guessing the intended teacher's
-- address would be worse than leaving it open for the few minutes it takes to
-- bind. Bind it before you hand it out — either through
-- `configure_teacher_invitation()` or the SQL in
-- `docs/TEACHER_VERIFICATION.md` §2 — and revoke it afterwards.
-- ============================================================================

-- `digest()` lives in `extensions` on a hosted project and in `public` in the
-- local stub, so every function below pins BOTH schemas (the same convention
-- 029's `start_checkin_session` uses for `gen_random_bytes`).
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Issued invitations — the digest, never the code
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_invitations (
  id                  uuid primary key default gen_random_uuid(),
  /** SHA-256 of the normalised code. The plaintext is never stored. */
  code_hash           text not null,
  /** What a human calls this invitation ("Alex Rivera — Fall 2026"). */
  label               text not null default '',
  /** When set, only this address may redeem it. Lower-cased on write. */
  intended_email      text,
  expires_at          timestamptz,
  /** `lower(auth.uid())` of the account that redeemed it, or null. */
  redeemed_by_auth    text,
  /** Their `profiles.id` when they had one at the time (may be null). */
  redeemed_by_profile uuid references public.profiles(id) on delete set null,
  /** The address that actually redeemed it, for the audit trail. */
  redeemed_email      text,
  redeemed_at         timestamptz,
  /** Once set, the invitation and any access it granted are dead. */
  revoked_at          timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

comment on table public.teacher_invitations is
  'Single-use teacher/director invitation codes, stored as SHA-256 digests. Redeemed only by redeem_teacher_invitation(); the plaintext code is never stored or returned anywhere.';

-- One row per code, so a duplicate issuance is a no-op rather than a second door.
create unique index if not exists teacher_invitations_code_hash_key
  on public.teacher_invitations (code_hash);

-- One live redemption per account: a second code cannot stack access, and a race
-- between two codes for the same person fails loudly instead of silently.
create unique index if not exists teacher_invitations_one_per_account
  on public.teacher_invitations (lower(redeemed_by_auth))
  where redeemed_at is not null and revoked_at is null;

create index if not exists teacher_invitations_redeemed_idx
  on public.teacher_invitations (lower(redeemed_by_auth))
  where redeemed_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Failed attempts — what the rate limit counts
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_invite_attempts (
  id           bigint generated always as identity primary key,
  /** Who tried. Nullable only so a row can survive an odd token-less call. */
  auth_user_id text,
  /** Best-effort client address, for limiting and forensics. Never the code. */
  ip           text,
  attempted_at timestamptz not null default now()
);

comment on table public.teacher_invite_attempts is
  'One row per *failed* invitation-code attempt, deleted when the same account succeeds. Read only by the rate-limit check; holds no code material.';

create index if not exists teacher_invite_attempts_account_idx
  on public.teacher_invite_attempts (lower(auth_user_id), attempted_at desc);
create index if not exists teacher_invite_attempts_ip_idx
  on public.teacher_invite_attempts (ip, attempted_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS + grants: no client path to either table at all
-- ---------------------------------------------------------------------------
alter table public.teacher_invitations      enable row level security;
alter table public.teacher_invite_attempts  enable row level security;

-- Deliberately no policies: the service role bypasses RLS, the SECURITY DEFINER
-- functions below run as their owner, and nobody else may read or write a row.
revoke all on table public.teacher_invitations     from public, anon, authenticated;
revoke all on table public.teacher_invite_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Normalising and hashing a code
-- ---------------------------------------------------------------------------
-- Case and punctuation are cosmetic: "I LOVE MUSIC", "i-love-music" and
-- "ilovemusic" are one invitation, which is what somebody reading a code off a
-- card and typing it on a phone should get. A code is therefore stored, and
-- compared, as its normalized digest.
create or replace function public.normalize_invitation_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g')), 64),
    ''
  )
$$;

comment on function public.normalize_invitation_code(text) is
  'Upper-cases a code and strips everything that is not a letter or digit, so case, spaces and punctuation are cosmetic. Internal.';

create or replace function public.invitation_code_hash(p_code text)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select case
    when public.normalize_invitation_code(p_code) is null then null
    else encode(digest(public.normalize_invitation_code(p_code), 'sha256'), 'hex')
  end
$$;

comment on function public.invitation_code_hash(text) is
  'SHA-256 hex digest of a normalized invitation code. Internal — never granted to a client.';

revoke all on function public.normalize_invitation_code(text) from public, anon, authenticated;
revoke all on function public.invitation_code_hash(text)         from public, anon, authenticated;
grant execute on function public.normalize_invitation_code(text) to service_role;
grant execute on function public.invitation_code_hash(text)      to service_role;

-- ---------------------------------------------------------------------------
-- 5. Who is calling, and can they teach?
-- ---------------------------------------------------------------------------
-- The caller's own address, straight from Supabase Auth. Their own only: the
-- function filters on `auth.uid()`, so it cannot be used to look anybody up.
create or replace function public.current_auth_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(u.email)
    from auth.users u
   where u.id::text = public.current_auth_id()
$$;

comment on function public.current_auth_email() is
  'The signed-in account''s own email address from Supabase Auth, lower-cased. Internal.';

revoke all on function public.current_auth_email() from public, anon, authenticated;
grant execute on function public.current_auth_email() to service_role;

/**
 * Does the caller hold a live redeemed teacher invitation?
 *
 * This is the credential `create_program()` asks for. A system administrator
 * passes it too — they may already do anything — which keeps 029's promise that
 * `system.manage` is not narrowed by this migration.
 */
create or replace function public.has_teacher_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_program_admin()
      or exists (
        select 1
          from public.teacher_invitations i
         where lower(i.redeemed_by_auth) = lower(public.current_auth_id())
           and i.redeemed_at is not null
           and i.revoked_at is null
      )
$$;

comment on function public.has_teacher_access() is
  'True when the caller is a verified teacher (a live redeemed invitation) or a system administrator.';

revoke all on function public.has_teacher_access() from public, anon;
grant execute on function public.has_teacher_access() to authenticated, service_role;

/**
 * What the account settings / verification screen renders from. Answers with the
 * caller's own state only, and never with a code or a digest.
 */
create or replace function public.teacher_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_auth text := public.current_auth_id();
  v_at   timestamptz;
  v_type text;
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.', 'verified', false);
  end if;

  select i.redeemed_at into v_at
    from public.teacher_invitations i
   where lower(i.redeemed_by_auth) = lower(v_auth)
     and i.redeemed_at is not null
     and i.revoked_at is null
   limit 1;

  select s.account_type into v_type
    from public.signup_account_types s
   where s.auth_user_id = v_auth;

  return jsonb_build_object(
    'ok', true,
    'verified', v_at is not null,
    'redeemed_at', v_at,
    'account_type', v_type,
    -- Declared as a teacher, not (yet) verified: the screen says "pending".
    'pending', v_type = 'teacher' and v_at is null,
    'admin', public.is_program_admin()
  );
end
$$;

comment on function public.teacher_access_status() is
  'The caller''s own teacher-verification state (verified / pending). Returns no code material.';

revoke all on function public.teacher_access_status() from public, anon;
grant execute on function public.teacher_access_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Redeeming a code — the only way access is granted
-- ---------------------------------------------------------------------------
create or replace function public.redeem_teacher_invitation(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth    text := public.current_auth_id();
  v_email   text;
  v_profile uuid;
  v_ip      text;
  v_hash    text;
  v_id      uuid;
  v_inv     public.teacher_invitations%rowtype;
  v_fails   int;
  v_ip_fails int;
  -- Said once, used for every "no". It never distinguishes a wrong code from an
  -- unknown one, so a client cannot learn which invitations exist by asking.
  c_generic constant text := 'That invitation code isn''t valid. Check it and try again.';
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  v_email   := public.current_auth_email();
  v_profile := public.current_profile_id();

  -- Best effort: PostgREST exposes the request headers. Absent is fine — the
  -- per-account limit below is the one that cannot be evaded.
  begin
    v_ip := nullif(
      (current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'),
      ''
    );
  exception
    when others then v_ip := null;
  end;
  v_ip := left(v_ip, 64);

  -- Already verified? Nothing to redeem, and no second code should stack.
  if exists (
    select 1 from public.teacher_invitations i
     where lower(i.redeemed_by_auth) = lower(v_auth)
       and i.redeemed_at is not null
       and i.revoked_at is null
  ) then
    return jsonb_build_object(
      'ok', true, 'verified', true,
      'message', 'This account already has teacher access.'
    );
  end if;

  -- --- rate limit ---------------------------------------------------------
  select count(*) into v_fails
    from public.teacher_invite_attempts a
   where lower(a.auth_user_id) = lower(v_auth)
     and a.attempted_at > now() - interval '15 minutes';

  if v_fails >= 5 then
    return jsonb_build_object(
      'ok', false,
      'message', 'Too many incorrect codes. Wait a few minutes before trying again.',
      'rate_limited', true
    );
  end if;

  if v_ip is not null then
    select count(*) into v_ip_fails
      from public.teacher_invite_attempts a
     where a.ip = v_ip
       and a.attempted_at > now() - interval '15 minutes';

    if v_ip_fails >= 20 then
      return jsonb_build_object(
        'ok', false,
        'message', 'Too many incorrect codes from here. Wait a few minutes before trying again.',
        'rate_limited', true
      );
    end if;
  end if;

  v_hash := public.invitation_code_hash(p_code);

  if v_hash is null then
    insert into public.teacher_invite_attempts (auth_user_id, ip) values (lower(v_auth), v_ip);
    return jsonb_build_object('ok', false, 'message', c_generic);
  end if;

  -- --- the redemption: one atomic UPDATE is the whole concurrency story ----
  -- Every condition is in the WHERE clause, so the row lock decides the winner
  -- and the loser re-evaluates to "no rows" rather than double-redeeming.
  update public.teacher_invitations i
     set redeemed_by_auth    = lower(v_auth),
         redeemed_by_profile = v_profile,
         redeemed_email      = v_email,
         redeemed_at         = now()
   where i.code_hash = v_hash
     and i.redeemed_at is null
     and i.revoked_at is null
     and (i.expires_at is null or i.expires_at > now())
     and (
       i.intended_email is null
       or (v_email is not null and lower(i.intended_email) = v_email)
     )
  returning i.id into v_id;

  if v_id is null then
    insert into public.teacher_invite_attempts (auth_user_id, ip) values (lower(v_auth), v_ip);

    -- Why it failed. This is only *reachable* by somebody who already knew the
    -- code, so it gives them a usable answer without becoming an oracle for
    -- somebody guessing: an unknown code and a wrong-looking one get one text.
    select * into v_inv from public.teacher_invitations where code_hash = v_hash;

    if v_inv.id is null then
      return jsonb_build_object('ok', false, 'message', c_generic);
    elsif v_inv.revoked_at is not null then
      return jsonb_build_object(
        'ok', false,
        'message', 'That invitation has been cancelled. Ask your program administrator for a new one.'
      );
    elsif v_inv.redeemed_at is not null then
      return jsonb_build_object(
        'ok', false,
        'message', 'That invitation code has already been used. Each one works once.'
      );
    elsif v_inv.expires_at is not null and v_inv.expires_at <= now() then
      return jsonb_build_object(
        'ok', false,
        'message', 'That invitation code has expired. Ask your program administrator for a new one.'
      );
    else
      return jsonb_build_object(
        'ok', false,
        'message', 'That invitation was issued to a different email address. Sign in with that address, or ask for a new code.'
      );
    end if;
  end if;

  -- --- the grant ----------------------------------------------------------
  -- Deliberately nothing else is written. The redeemed row IS the credential:
  -- `has_teacher_access()` reads it on every request, so there is one authority
  -- rather than a second flag that could drift out of step with it.
  -- `signup_account_types` is left exactly as it was — it records the choice
  -- somebody made at sign-up (023/024), which this migration no longer treats
  -- as a credential at all. In particular a verified teacher whose sign-up
  -- answer was "student" keeps that answer, and still passes the gate, because
  -- `create_program()` asks `has_teacher_access()` before it looks at the type.

  -- Clear the failures this account accumulated, so one bad minute is not a lockout.
  delete from public.teacher_invite_attempts where lower(auth_user_id) = lower(v_auth);

  perform public.log_audit(
    'teacher.invite_redeem',
    null::uuid,
    v_profile,
    null::uuid,
    jsonb_build_object('invitation_id', v_id)
  );

  return jsonb_build_object(
    'ok', true,
    'verified', true,
    'message', 'You''re verified — you can start a program of your own now.'
  );
exception
  when unique_violation then
    -- The partial unique index fired: this account already holds a live
    -- redemption (a race with its own second attempt, or a code issued twice).
    return jsonb_build_object(
      'ok', false,
      'message', 'This account already has teacher access.'
    );
end
$$;

comment on function public.redeem_teacher_invitation(text) is
  'Redeem a teacher invitation code. Atomic, single-use, optionally email-bound and expiring; rate-limited per account and address. The only path that grants verified teacher access.';

revoke all on function public.redeem_teacher_invitation(text) from public, anon;
grant execute on function public.redeem_teacher_invitation(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Administrative setup — issuing, binding, listing and revoking
-- ---------------------------------------------------------------------------
-- Gated on `is_program_admin()` (the `program_admins` table, 013/029): the
-- cross-program administrator, not a program director. Somebody has to be able
-- to issue these, and today that is the operator. `docs/TEACHER_VERIFICATION.md`
-- gives the equivalent one-off SQL, which is what an operator without a
-- system-admin account uses.
create or replace function public.configure_teacher_invitation(
  p_code           text,
  p_label          text default '',
  p_intended_email text default null,
  p_expires_at     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash   text := public.invitation_code_hash(p_code);
  v_actor  uuid := public.current_profile_id();
  v_email  text := nullif(lower(btrim(coalesce(p_intended_email, ''))), '');
  v_id     uuid;
  v_state  public.teacher_invitations%rowtype;
begin
  if not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Only a system administrator can issue teacher invitations.');
  end if;

  if v_hash is null or length(public.normalize_invitation_code(p_code)) < 8 then
    return jsonb_build_object('ok', false, 'message', 'Give the invitation a code of at least 8 letters or digits.');
  end if;

  if v_email is not null and position('@' in v_email) < 2 then
    return jsonb_build_object('ok', false, 'message', 'That does not look like an email address.');
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That expiry date is in the past.');
  end if;

  select * into v_state from public.teacher_invitations where code_hash = v_hash;

  if v_state.id is null then
    insert into public.teacher_invitations (code_hash, label, intended_email, expires_at, created_by)
    values (v_hash, left(btrim(coalesce(p_label, '')), 120), v_email, p_expires_at, v_actor)
    returning id into v_id;

    perform public.log_audit('teacher.invite_create', null::uuid, null::uuid, null::uuid,
      jsonb_build_object('invitation_id', v_id, 'label', p_label, 'email_bound', v_email is not null));
  else
    if v_state.redeemed_at is not null then
      return jsonb_build_object('ok', false, 'message', 'That code has already been redeemed — issue a different one instead.');
    end if;
    if v_state.revoked_at is not null then
      return jsonb_build_object('ok', false, 'message', 'That code has been cancelled — issue a different one instead.');
    end if;

    -- Binding, re-binding and (re)scheduling are all just this update: a code
    -- that has not been used yet is still editable, which is what makes
    -- "bind the seeded code to the intended teacher" a one-liner.
    update public.teacher_invitations
       set label          = left(btrim(coalesce(p_label, '')), 120),
           intended_email = v_email,
           expires_at     = p_expires_at
     where id = v_state.id
    returning id into v_id;

    perform public.log_audit('teacher.invite_update', null::uuid, null::uuid, null::uuid,
      jsonb_build_object('invitation_id', v_id, 'label', p_label, 'email_bound', v_email is not null));
  end if;

  return jsonb_build_object(
    'ok', true,
    'invitation_id', v_id,
    'message', 'Invitation saved. The code itself is never stored, so keep a copy — it cannot be read back.'
  );
end
$$;

comment on function public.configure_teacher_invitation(text, text, text, timestamptz) is
  'System administrator: create an invitation, or bind/re-label/reschedule one that has not been redeemed. The code is hashed on arrival and never read back.';

revoke all on function public.configure_teacher_invitation(text, text, text, timestamptz) from public, anon;
grant execute on function public.configure_teacher_invitation(text, text, text, timestamptz) to authenticated, service_role;

/** The invitation list, for an administrator. Ids and state — never a digest. */
create or replace function public.list_teacher_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Only a system administrator can read teacher invitations.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'invitations', coalesce(
      (
        select jsonb_agg(entry order by entry->>'created_at')
          from (
            select jsonb_build_object(
              'id', i.id,
              'label', i.label,
              'intended_email', i.intended_email,
              'expires_at', i.expires_at,
              'redeemed_at', i.redeemed_at,
              'redeemed_email', i.redeemed_email,
              'revoked_at', i.revoked_at,
              'created_at', i.created_at,
              'status', case
                when i.revoked_at is not null then 'revoked'
                when i.redeemed_at is not null then 'redeemed'
                when i.expires_at is not null and i.expires_at <= now() then 'expired'
                else 'available'
              end
            ) as entry
            from public.teacher_invitations i
          ) t
      ),
      '[]'::jsonb
    )
  );
end
$$;

comment on function public.list_teacher_invitations() is
  'System administrator: every teacher invitation with its state. Returns no code and no digest.';

revoke all on function public.list_teacher_invitations() from public, anon;
grant execute on function public.list_teacher_invitations() to authenticated, service_role;

/**
 * Revoke by id. On an unredeemed code it removes the door; on a redeemed one it
 * also takes the access back — `has_teacher_access()` stops answering true on
 * the holder's very next request, because nothing is cached (029's rule).
 */
create or replace function public.revoke_teacher_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.teacher_invitations%rowtype;
begin
  if not public.is_program_admin() then
    return jsonb_build_object('ok', false, 'message', 'Only a system administrator can revoke teacher invitations.');
  end if;

  select * into v_row from public.teacher_invitations where id = p_invitation_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'message', 'That invitation no longer exists.');
  end if;

  if v_row.revoked_at is null then
    update public.teacher_invitations set revoked_at = now() where id = v_row.id;

    perform public.log_audit('teacher.invite_revoke', null::uuid, v_row.redeemed_by_profile, null::uuid,
      jsonb_build_object('invitation_id', v_row.id, 'was_redeemed', v_row.redeemed_at is not null));

    -- Free the account for a replacement code: the one-live-redemption index
    -- ignores revoked rows, so re-issuing to the same person works.
    delete from public.teacher_invite_attempts where lower(auth_user_id) = lower(coalesce(v_row.redeemed_by_auth, ''));
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', case
      when v_row.redeemed_at is not null then 'Revoked — that account no longer has teacher access.'
      else 'Revoked — that code can no longer be redeemed.'
    end
  );
end
$$;

comment on function public.revoke_teacher_invitation(uuid) is
  'System administrator: revoke an invitation, including the teacher access it already granted.';

revoke all on function public.revoke_teacher_invitation(uuid) from public, anon;
grant execute on function public.revoke_teacher_invitation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The seeded initial invitation
-- ---------------------------------------------------------------------------
-- Digest only — the code itself appears nowhere in this repository. It is the
-- one supplied by the project owner, normalised by `normalize_invitation_code()`
-- (upper-cased, punctuation removed) and hashed with SHA-256.
--
-- `on conflict do nothing` is load-bearing: re-running this migration must not
-- resurrect a redeemed invitation or reset its binding.
insert into public.teacher_invitations (code_hash, label)
values (
  '4dd7073f2f1f7f95fc13f33d1b5cfb5a296c5cb5f8bb422a0d64df88a9a7896d',
  'Initial teacher invitation (bind it to the intended teacher, then revoke it)'
)
on conflict (code_hash) do nothing;

-- ---------------------------------------------------------------------------
-- 9. create_program(): the declared type is no longer the credential
-- ---------------------------------------------------------------------------
-- Body carried over from 031 unchanged except the teacher gate, which now asks
-- `has_teacher_access()` instead of trusting `signup_account_types`. An account
-- that was never verified keeps exactly one door: the one 023 already opened for
-- an existing director.
create or replace function public.create_program(
  p_name         text,
  p_short_name   text default null,
  p_display_name text default null,
  p_theme_color  text default null,
  p_instruments  text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth         text := public.current_auth_id();
  v_profile      uuid;
  v_account_type text;
  v_result       jsonb;
  v_ensemble     uuid;
  v_added        int := 0;
  v_raw          text;
  v_name         text;
  v_seen         text[] := '{}';
begin
  if v_auth is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in first.');
  end if;

  select account_type into v_account_type
    from public.signup_account_types
   where auth_user_id = v_auth;

  -- The credential is a redeemed invitation, not the box ticked at sign-up.
  if not public.has_teacher_access() then
    select id into v_profile
      from public.profiles
     where auth_user_id = v_auth;

    -- An existing director keeps the ability 023 gave them: a migration cannot
    -- issue invitations to the people who are already running programs.
    if v_profile is null or not public.is_director_anywhere(v_profile) then
      if v_account_type = 'student' then
        return jsonb_build_object(
          'ok', false,
          'message', 'Student accounts join with a director''s code; only verified teacher accounts can start a program.'
        );
      end if;

      return jsonb_build_object(
        'ok', false,
        'message', 'Teacher access needs an invitation code. Enter yours under Teacher access, then start your program.'
      );
    end if;
  end if;

  v_result := public.create_program_unchecked(
    p_name,
    p_short_name,
    p_display_name,
    p_theme_color
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    return v_result;
  end if;

  v_ensemble := (v_result ->> 'program_id')::uuid;

  -- Sections from the instruments the director listed. Blank entries are
  -- skipped, duplicates (case-insensitively) collapse to the first spelling,
  -- and the list is capped so a pathological payload cannot fill the table.
  if p_instruments is not null then
    foreach v_raw in array p_instruments loop
      exit when v_added >= 60;

      v_name := public.normalize_section_name(v_raw);
      continue when v_name = '';
      continue when lower(v_name) = any (v_seen);

      v_seen := array_append(v_seen, lower(v_name));
      insert into public.sections (ensemble_id, name, sort_order)
      values (v_ensemble, v_name, v_added)
      on conflict (ensemble_id, name) do nothing;
      v_added := v_added + 1;
    end loop;
  end if;

  return v_result || jsonb_build_object('section_count', v_added);
end
$$;

comment on function public.create_program(text, text, text, text, text[]) is
  'Start a new program for a verified teacher (a redeemed invitation), a system administrator, or an existing director; optionally creates one section per named instrument.';

revoke all on function public.create_program(text, text, text, text, text[]) from public, anon;
grant execute on function public.create_program(text, text, text, text, text[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Verification — the door is real, and it fails closed
-- ---------------------------------------------------------------------------
do $$
declare
  v_hash   text;
  v_id     uuid;
  v_first  jsonb;
  v_second jsonb;
  v_count  int;
  v_anon   text;
begin
  -- The seeded invitation is present and still unredeemed. (Not "exactly one
  -- row" — an operator may legitimately have issued others since.)
  if not exists (
    select 1 from public.teacher_invitations
     where code_hash = '4dd7073f2f1f7f95fc13f33d1b5cfb5a296c5cb5f8bb422a0d64df88a9a7896d'
  ) then
    raise exception 'FAIL: the initial teacher invitation was not seeded';
  end if;

  -- The credential is the redeemed row, not the declaration.
  perform set_config('request.jwt.claims', '{}', true);
  if public.has_teacher_access() then
    raise exception 'FAIL: a signed-out caller has teacher access';
  end if;

  if public.redeem_teacher_invitation('anything') ->> 'ok' <> 'false' then
    raise exception 'FAIL: a signed-out caller redeemed a code';
  end if;

  -- A declared teacher who has redeemed nothing has no access.
  insert into public.signup_account_types (auth_user_id, account_type)
  values ('03500000-0000-4000-8000-000000000001', 'teacher')
  on conflict (auth_user_id) do nothing;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"03500000-0000-4000-8000-000000000001","role":"authenticated","email":"pending@example.invalid"}',
    true
  );
  if public.has_teacher_access() then
    raise exception 'FAIL: a self-declared teacher had access without redeeming a code';
  end if;

  -- The seeded code is NOT touched here: it is single-use and belongs to the
  -- operator. These checks use a throwaway invitation, which is removed below.
  -- (`invitation_code_hash()` rather than raw `digest()`: on a hosted project
  -- pgcrypto lives in `extensions`, which a bare DO block does not search.)
  v_hash := public.invitation_code_hash('035-TEMP-INVITE');
  insert into public.teacher_invitations (id, code_hash, label)
  values ('03500000-0000-4000-8000-0000000000aa', v_hash, 'migration self-check')
  returning id into v_id;

  v_first := public.redeem_teacher_invitation('035-temp-invite');
  if v_first ->> 'ok' <> 'true' then
    raise exception 'FAIL: a valid invitation was refused: %', v_first;
  end if;
  if not public.has_teacher_access() then
    raise exception 'FAIL: redeeming did not grant teacher access';
  end if;
  if public.redeem_teacher_invitation('035-temp-invite') ->> 'verified' <> 'true' then
    raise exception 'FAIL: redeeming twice did not report the existing access';
  end if;

  -- A different account cannot reuse it.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"03500000-0000-4000-8000-000000000002","role":"authenticated","email":"second@example.invalid"}',
    true
  );
  if public.has_teacher_access() then
    raise exception 'FAIL: a second account inherited the first account''s access';
  end if;
  v_second := public.redeem_teacher_invitation('035-TEMP-INVITE');
  if v_second ->> 'ok' <> 'false' or v_second ->> 'message' not ilike '%already been used%' then
    raise exception 'FAIL: a redeemed code was reusable: %', v_second;
  end if;

  select count(*) into v_count
    from public.teacher_invitations
   where code_hash = v_hash and redeemed_at is not null;
  if v_count <> 1 then
    raise exception 'FAIL: the redeemed invitation is not marked redeemed exactly once';
  end if;

  -- An expired code grants nothing.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"03500000-0000-4000-8000-000000000003","role":"authenticated","email":"expired@example.invalid"}',
    true
  );
  insert into public.teacher_invitations (code_hash, label, expires_at)
  values (public.invitation_code_hash('035TEMPEXPIRED'), 'expired self-check', now() - interval '1 minute');
  if public.redeem_teacher_invitation('035 temp expired') ->> 'ok' <> 'false' then
    raise exception 'FAIL: an expired invitation was redeemed';
  end if;
  if public.has_teacher_access() then
    raise exception 'FAIL: an expired invitation granted access';
  end if;

  -- An email-bound code refuses a caller whose account does not carry that
  -- address. (The positive half — the bound address itself redeeming — needs an
  -- `auth.users` fixture and lives in supabase/tests/teacher_invitations.sql,
  -- which is where fixture accounts belong; a migration must not create one.)
  insert into public.teacher_invitations (code_hash, label, intended_email)
  values (public.invitation_code_hash('035TEMPBOUND'), 'bound self-check', 'right@example.invalid');
  if public.redeem_teacher_invitation('035TEMPBOUND') ->> 'ok' <> 'false' then
    raise exception 'FAIL: an email-bound invitation was redeemed by the wrong address';
  end if;
  if public.has_teacher_access() then
    raise exception 'FAIL: a mismatched address granted access';
  end if;
  if not exists (
    select 1 from public.teacher_invitations
     where code_hash = public.invitation_code_hash('035TEMPBOUND')
       and redeemed_at is null
  ) then
    raise exception 'FAIL: a refused redemption still marked the invitation used';
  end if;

  -- Failed attempts are recorded and then limited.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"03500000-0000-4000-8000-000000000005","role":"authenticated","email":"bruteforce@example.invalid"}',
    true
  );
  insert into public.teacher_invite_attempts (auth_user_id)
  select '03500000-0000-4000-8000-000000000005' from generate_series(1, 5);
  if public.redeem_teacher_invitation('035TEMPBOUND') ->> 'rate_limited' <> 'true' then
    raise exception 'FAIL: failed attempts are not rate-limited';
  end if;

  -- A student cannot promote themselves by writing their own account type, and
  -- an unknown account resolves to nothing at all.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"03500000-0000-4000-8000-000000000006","role":"authenticated","email":"student@example.invalid"}',
    true
  );
  begin
    perform public.set_signup_account_type('teacher');
    raise exception 'FAIL: a new account classified itself as a teacher';
  exception
    when raise_exception then
      -- Anything other than the expected refusal (including the FAIL above) is
      -- re-raised, so this can never pass by swallowing its own assertion.
      if sqlerrm not like 'Signup type can only be set shortly after account creation.%' then
        raise;
      end if;
  end;

  -- A student cannot simply ask: the client-facing setter still refuses, and
  -- nothing in the client can write the credential tables at all.
  if has_table_privilege('authenticated', 'public.teacher_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.teacher_invitations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.teacher_invite_attempts', 'INSERT') then
    raise exception 'FAIL: authenticated can reach the invitation tables directly';
  end if;

  -- The gate really is what create_program asks.
  if pg_get_functiondef('public.create_program(text, text, text, text, text[])'::regprocedure)
       not like '%has_teacher_access%' then
    raise exception 'FAIL: create_program() does not ask has_teacher_access()';
  end if;

  -- No anonymous path to any of the new entry points.
  select string_agg(p.proname, ', ')
    into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'redeem_teacher_invitation', 'teacher_access_status', 'has_teacher_access',
       'invitation_code_hash', 'normalize_invitation_code', 'current_auth_email'
     )
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_anon is not null then
    raise exception 'FAIL: anon can execute: %', v_anon;
  end if;

  if has_function_privilege('authenticated', 'public.invitation_code_hash(text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can hash codes directly';
  end if;

  -- Clean up the self-check without disturbing the seeded invitation. Scoped by
  -- fixture id, so re-running this migration cannot wipe real attempt history.
  delete from public.teacher_invitations
   where id = v_id
      or code_hash in (
        public.invitation_code_hash('035TEMPEXPIRED'),
        public.invitation_code_hash('035TEMPBOUND')
      );
  delete from public.teacher_invite_attempts
   where auth_user_id like '03500000-0000-4000-8000-%';
  delete from public.signup_account_types
   where auth_user_id like '03500000-0000-4000-8000-%';
  perform set_config('request.jwt.claims', '{}', true);

  if exists (
    select 1 from public.teacher_invitations
     where id = v_id
        or code_hash in (
          public.invitation_code_hash('035TEMPEXPIRED'),
          public.invitation_code_hash('035TEMPBOUND')
        )
  ) or exists (
    select 1 from public.teacher_invite_attempts
     where auth_user_id like '03500000-0000-4000-8000-%'
  ) then
    raise exception 'FAIL: the self-check left state behind';
  end if;

  raise notice '035 OK: invitation codes are hashed, single-use, atomic, expiring and email-bindable; create_program() now requires a redeemed invitation';
end
$$;
