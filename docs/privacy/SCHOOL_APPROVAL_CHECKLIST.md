# School Approval Checklist (DRAFT)

A practical sequence for getting approval. Tick as you go; **[district]** items
need the school/district; **[dev]** items are the developer's.

## Phase 0 — Do not skip
- [ ] **[dev]** Do **not** enter real student data yet (use fictional test records).
- [ ] **[dev]** Rotate Supabase management token + service-role keys; delete the
      retired Clerk secret; remove dead Clerk vars from `.env.local`.
- [ ] **[dev]** Enable MFA on Supabase, Vercel, GitHub, and the email account.

## Phase 1 — Paperwork
- [~] **[dev/district]** Privacy policy + terms **published in the app** as
      `/privacy` and `/terms` (drafts, placeholders open) — still to be
      **finalized** by the district. See [`WEBSITE_LEGAL_CHANGES.md`](WEBSITE_LEGAL_CHANGES.md).
- [ ] **[district]** Family notice decision (needed or not?).
- [ ] **[district]** District vendor-approval form completed.
- [ ] **[district]** Data-processing agreement reviewed and signed (parent/
      guardian involved if the operator is a minor).
- [ ] **[district]** Confirm FERPA basis (school-official listing) and RCW
      28A.604 applicability. **[counsel]**

## Phase 2 — Technical readiness
- [x] **[dev]** Migration 028 + all SQL suites verified locally (throwaway DB, 10/10 pass).
- [x] **[dev]** Migration 028 applied to production; privacy suite passes live.
- [x] **[dev]** Edge-function CORS change deployed and verified live (allowed origins echoed, foreign refused).
- [ ] **[dev]** Schedule the stale-invite purge so retention actually runs.
- [ ] **[dev]** Backups enabled or export routine documented.
- [ ] **[district]** Confirm the Google Calendar feed is intentionally public.
- [ ] **[dev]** Decide excuse-reason handling.

## Phase 3 — Controlled pilot
- [ ] **[district]** Approve a single program and a small roster for a pilot.
- [ ] **[dev/district]** Test sign-in, check-in, roster, and deletion end-to-end.
- [ ] **[dev/district]** Verify a student cannot see another program's data.
- [ ] **[district]** Confirm who is available for support and incidents.

## Phase 4 — Go live / review
- [ ] **[district]** Written go-ahead.
- [ ] **[dev]** Retention schedule and provider list kept current.
- [ ] **[both]** Review before each new term.

## Roles to fill
- District approver: ________
- District IT contact: ________
- District privacy/legal contact: ________
- Developer: ________
- Parent/guardian (if minor): ________
