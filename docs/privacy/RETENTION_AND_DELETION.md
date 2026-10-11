# Data Retention & Deletion Schedule (DRAFT)

> **DRAFT.** Values in `[…]` need the district's decision. Retention of school
> records is ultimately the **school's** call.

| Data | Default retention | Deletion trigger | Mechanism |
|---|---|---|---|
| Account identity (email, auth id) | Until account deleted | user deletes account / school request | `delete-account` edge function → Supabase Auth delete |
| Profile name, avatar | Until account deleted | account deletion (renamed "Deleted account") | `prepare_account_deletion()` |
| Memberships, notifications, personal events | Until account deleted | account deletion | `prepare_account_deletion()` |
| **Attendance records** | **[SCHOOL-DECIDED, e.g. current year + N]** | school request | **retained, de-identified** on account deletion |
| Attendance staff notes | same as attendance | with the record | deleted with record |
| Pending program invitations | **[e.g. 30 days]** | not accepted | `purge_stale_program_invites()` (migration 028 — applied; **needs a scheduled caller**) |
| Check-in sessions / codes | 5 minutes | expiry / new session | deleted on `start_checkin_session` |
| Check-in / join-code attempt logs | **[e.g. 30 days]** | age | *not yet automated* — add a purge job |
| Signup account types | until account deleted | account deletion | `delete_signup_account_type()` |
| Provider backups | provider plan window | plan expiry | Supabase/Vercel |

## Account deletion — what actually happens today
From [`supabase/functions/delete-account`](../../supabase/functions/delete-account/index.ts)
and [`025_delete_account.sql`](../../supabase/migrations/025_delete_account.sql):
1. The caller's own token is verified (no one can delete another account).
2. `prepare_account_deletion()` **deletes** memberships, `program_admins`,
   reminders, notifications, personal events, check-in attempts/sessions; **nulls
   the author** on attendance notes/events; **deletes `signup_account_types`**;
   and **replaces** the profile's name/avatar with "Deleted account" and clears
   `auth_user_id`.
3. The Supabase Auth user is deleted.
4. **Attendance rows are kept**, now attached to the de-identified profile.

**Important:** this is **pseudonymization, not full erasure.** If the district
requires complete deletion of a student's attendance history on request, that is
a different operation and must be added (and documented). Decide this with the
district. **[counsel]**

## Known gaps to close
- No automated purge for `checkin_attempts` / `join_code_attempts`.
- Stale-invite purge is **applied to production** but nothing calls it yet —
  schedule it (Supabase Cron / a scheduled function).
- No written retention sign-off from the school yet.
