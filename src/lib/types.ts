/**
 * Row + RPC types for the multi-program schema.
 *
 * `profiles` is pure person-level identity: roles and section live on
 * `memberships` (per program), which is why nothing here has `roles` on the
 * profile. The database calls a program an `ensemble`; the interface never does
 * — it says **program** (see docs/PLATFORM_PLAN.md §2.4 U14).
 */

export type Role = "student" | "section_leader" | "secretary" | "director";

/** Flexible event type — any text from the database, labelled via EVENT_TYPE_LABEL. */
export type EventType = string;

/** How attendance is collected: QR scan, staff toggles, both, or none. */
export type CheckinMode = "qr" | "toggle" | "both" | "none";

/** Whether the event expects students to check in. */
export type AttendanceRequirement = "required" | "optional" | "none";

/** Where an event came from — the app or the Google Calendar sync. */
export type EventSource = "manual" | "google_calendar";

export type AttendanceStatus = "present" | "absent" | "excused" | "late";

export interface Profile {
  id: string;
  clerk_id: string | null;
  full_name: string;
  display_name: string;
  avatar_url: string;
  must_change_password: boolean;
  deactivated: boolean;
  created_at: string;
}

export interface EnsembleRow {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  theme_color: string;
  logo_url: string;
  active: boolean;
  created_at: string;
}

export interface SectionRow {
  id: string;
  ensemble_id: string;
  name: string;
  sort_order: number;
}

export interface MembershipRow {
  id: string;
  user_id: string;
  ensemble_id: string;
  section_id: string | null;
  roles: Role[];
  active: boolean;
  joined_at: string;
}

export interface EventRow {
  id: string;
  ensemble_id: string;
  name: string;
  type: EventType;
  event_type: string;
  date: string;
  end_date: string | null;
  all_day: boolean;
  location: string;
  description: string;
  google_calendar_uid: string | null;
  google_calendar_updated_at: string | null;
  google_calendar_synced_at: string | null;
  checkin_mode: CheckinMode;
  attendance_requirement: AttendanceRequirement;
  event_source: EventSource;
  archived: boolean;
  late_minutes: number;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  created_by: string | null;
  created_at: string;
}

export interface CheckinSessionRow {
  id: string;
  event_id: string;
  token: string;
  entry_code: string;
  created_by: string;
  expires_at: string;
  created_at: string;
}

export interface AttendanceRow {
  id: string;
  event_id: string;
  student_id: string;
  attended: boolean;
  checked_in_at: string | null;
  status: AttendanceStatus;
  excuse_reason: string;
  is_late: boolean;
  marked_by: string | null;
}

export interface AttendanceStaffNoteRow {
  attendance_record_id: string;
  staff_note: string;
  created_by: string | null;
  updated_at: string;
}

export interface PersonalEventRow {
  id: string;
  owner_id: string;
  name: string;
  date: string;
  location: string;
  created_at: string;
}

export type NotificationType = "new_event" | "checkin_open" | "chat_message";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: { event_id?: string; event_name?: string } | null;
  read: boolean;
  created_at: string;
}

/**
 * Shape returned by every security-definer RPC. One optional bag is simpler than
 * a union per function, and the RPCs themselves always answer `{ ok, message }`
 * on failure.
 */
export interface RpcResult {
  ok: boolean;
  message?: string;
  token?: string;
  entry_code?: string;
  expires_at?: string;
  event_id?: string;
  event_name?: string;
  checked_in_at?: string | null;
  is_late?: boolean;
  enabled?: boolean;
  code?: string;
  percentage?: number;
  present?: number;
  late?: number;
  excused?: number;
  absent?: number;
  total?: number;
  /** Sync only: set when a suspicious feed was refused instead of archived. */
  warning?: string | null;
  /** `join_program()`: which program and roster row the call landed in. */
  profile_id?: string;
  program_id?: string;
  program_name?: string;
  membership_id?: string;
  /** `join_program()`: true when the caller added a program they were in already. */
  existing?: boolean;
}

/**
 * One entry of `list_active_programs()` — what the join screen offers. A join
 * code is never part of this: only whether the program has one set.
 */
export interface ProgramOption {
  slug: string;
  name: string;
  short_name: string;
  theme_color: string;
  logo_url: string;
  has_join_code: boolean;
}

/** One row of `get_attendance_trend`. */
export interface TrendRow {
  id: string;
  name: string;
  type: string;
  date: string;
  event_type: string;
  roster_size: number;
  present_count: number;
  excused_count: number;
  late_count: number;
}

/**
 * One row of the caller's own `my_attendance_trend` — their past required
 * events, newest first, with the status the percentage is built from.
 */
export interface MyAttendanceRow {
  id: string;
  name: string;
  event_type: string;
  date: string;
  status: AttendanceStatus;
  attended: boolean;
  checked_in_at: string | null;
}

/** One row of `get_section_attendance_stats`. */
export interface SectionStatRow {
  section: string;
  member_count: number;
  avg_attendance_pct: number;
  sort_order: number;
}

/** A member of the band: the person plus their membership and section. */
export interface RosterMember {
  user_id: string;
  section_id: string | null;
  section_name: string;
  roles: Role[];
  active: boolean;
  joined_at: string;
  profile: Pick<
    Profile,
    "id" | "full_name" | "display_name" | "avatar_url" | "deactivated" | "created_at"
  >;
}
