import type { PostgrestError } from "@supabase/supabase-js";
import type { AuthAudience } from "./constants";
import { supabase } from "./supabase";
import type {
  MyAttendanceRow,
  ProgramOption,
  RpcResult,
  SectionStatRow,
  TrendRow,
} from "./types";

export interface RpcResponse {
  result: RpcResult | null;
  error: PostgrestError | null;
}

export async function getSignupAccountType(): Promise<{
  accountType: AuthAudience | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("get_signup_account_type");
  if (error) return { accountType: null, error: error.message };
  if (data === "student" || data === "teacher") return { accountType: data, error: null };
  return { accountType: null, error: null };
}

export async function setSignupAccountType(audience: AuthAudience): Promise<{
  accountType: AuthAudience | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("set_signup_account_type", {
    p_account_type: audience,
  });
  if (error) return { accountType: null, error: error.message };
  if (data === "student" || data === "teacher") return { accountType: data, error: null };
  return { accountType: null, error: "The account type could not be confirmed." };
}

async function callRpc(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<RpcResponse> {
  const { data, error } = await supabase.rpc(fn, args);
  return { result: (data ?? null) as RpcResult | null, error };
}

/**
 * The handful of RPCs that answer with a JSON *array* instead of an
 * `{ ok, message }` object. A refusal still comes back as an object, so the
 * shape of the payload tells the two apart — no guessed flags.
 */
export interface RpcListResponse<T> {
  rows: T[];
  error: PostgrestError | null;
  /** Set only when the server refused the call ("Only directors…"). */
  message: string | null;
}

async function callRpcList<T>(
  fn: string,
  args: Record<string, unknown> = {}
): Promise<RpcListResponse<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (Array.isArray(data)) return { rows: data as T[], error, message: null };
  const refused = (data ?? null) as RpcResult | null;
  return {
    rows: [],
    error,
    message: refused && refused.ok === false ? (refused.message ?? null) : null,
  };
}

// --- Programs (any signed-in person) ----------------------------------------

/**
 * Every active program, so the join screen can offer real names instead of
 * asking somebody to spell a slug. Names and colours are not secret; join codes
 * never appear here — only whether one is set.
 */
export const listActivePrograms = () => callRpcList<ProgramOption>("list_active_programs");

/**
 * Join a program with its code. `p_display_name` is only used when the caller has
 * no profile yet (the code is what proves they may be here; the name is just
 * what to call them). Validated and rate-limited server-side, never in the
 * browser.
 */
export const joinProgram = (slug: string, code: string, displayName?: string) =>
  callRpc("join_program", {
    p_slug: slug,
    p_code: code,
    p_display_name: displayName?.trim() || null,
  });

/**
 * Start a program and become its director. Teacher accounts can do this without
 * approval or a code; student accounts are refused by the server.
 *
 * The name is the only thing the caller controls: the RPC always creates a
 * **new** program with the caller as `{director}`, so this can never be pointed
 * at an existing one. It also handles their first-ever `profiles` row (which is
 * why `displayName` matters when they have none), gives the program a join code
 * to start with, and refuses a blank name or a sixth program inside an hour.
 */
export const createProgram = (
  name: string,
  opts?: { shortName?: string; displayName?: string }
) =>
  callRpc("create_program", {
    p_name: name.trim(),
    p_short_name: opts?.shortName?.trim() || null,
    p_display_name: opts?.displayName?.trim() || null,
  });

// --- Join code (director) ---------------------------------------------------

/** Director-only: the program's current join code. */
export const getJoinCode = (programId: string) =>
  callRpc("get_join_code", { p_ensemble: programId });

/** Director-only: replace the program's join code. */
export const setJoinCode = (programId: string, code: string) =>
  callRpc("set_join_code", { p_ensemble: programId, p_code: code });

// --- Roster -----------------------------------------------------------------

/** Director-only. `memberId` must be on this program's roster. */
export const deactivateMember = (programId: string, memberId: string) =>
  callRpc("deactivate_member", { p_ensemble: programId, p_member_id: memberId });

/** Director-only. */
export const reactivateMember = (programId: string, memberId: string) =>
  callRpc("reactivate_member", { p_ensemble: programId, p_member_id: memberId });

/**
 * Directors move anyone in the program; a member may move *themselves*
 * (that is what the Profile screen's section picker calls).
 */
export const setMemberSection = (
  programId: string,
  memberId: string,
  sectionId: string | null
) =>
  callRpc("set_member_section", {
    p_ensemble: programId,
    p_member_id: memberId,
    p_section_id: sectionId,
  });

// --- Check-in ---------------------------------------------------------------

/** Staff (director, secretary or section leader): mint a fresh QR + code. */
export const startCheckinSession = (eventId: string) =>
  callRpc("start_checkin_session", { p_event_id: eventId });

/** Student: check in with the token in a QR code (deep link `/checkin?token=…`). */
export const recordAttendance = (token: string) =>
  callRpc("record_attendance", { p_token: token });

/** Student: check in with the 8-character code shown on screen. */
export const recordAttendanceByCode = (code: string) =>
  callRpc("record_attendance_by_code", { p_code: code });

/**
 * Staff: set a student's attendance for an event. `status` may be the legacy
 * boolean or "present" | "absent" | "excused" | "late".
 */
export const overrideAttendance = (
  eventId: string,
  studentId: string,
  status: string | boolean,
  excuseReason?: string,
  staffNote?: string
) => {
  if (typeof status === "boolean") {
    return callRpc("override_attendance", {
      p_event_id: eventId,
      p_student_id: studentId,
      p_attended: status,
    });
  }
  return callRpc("override_attendance", {
    p_event_id: eventId,
    p_student_id: studentId,
    p_status: status,
    p_excuse_reason: excuseReason ?? "",
    p_staff_note: staffNote ?? "",
  });
};

// --- My own numbers (any member) -------------------------------------------

/**
 * The caller's own attendance percentage. Same formula as the director-facing
 * analytics, so a student and their director can never see different numbers.
 * Unlike the analytics RPCs this one needs no staff role — it is always about
 * you.
 */
export const getMyAttendancePct = (programId: string) =>
  callRpc("my_attendance_pct", { p_ensemble: programId });

/** The caller's own recent required events, newest first. */
export const getMyAttendanceTrend = (programId: string, limit = 8) =>
  callRpcList<MyAttendanceRow>("my_attendance_trend", { p_ensemble: programId, p_limit: limit });

// --- Analytics (director of that program, or a program admin) ---------------

/** Percentage for one student. The program travels with the student id. */
export const getStudentAttendancePct = (studentId: string, programId: string) =>
  callRpc("get_student_attendance_pct", {
    p_student_id: studentId,
    p_ensemble: programId,
  });

/** Per-section averages, canonical order, `[]` when there is nothing yet. */
export const getSectionAttendanceStats = (programId: string) =>
  callRpcList<SectionStatRow>("get_section_attendance_stats", { p_ensemble: programId });

/** The program is derived from the event — a client cannot name another one. */
export const getEventAttendanceSummary = (eventId: string) =>
  callRpc("get_event_attendance_summary", { p_event_id: eventId });

/** Last N required events that have already happened, newest first. */
export const getAttendanceTrend = (programId: string, limit = 10) =>
  callRpcList<TrendRow>("get_attendance_trend", { p_ensemble: programId, p_limit: limit });
