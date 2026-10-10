import type {
  AttendanceRequirement,
  AttendanceStatus,
  CheckinMode,
  Role,
} from "./types";

/**
 * Programme vocabulary.
 *
 * The site is the Redmond High School Music and Arts Program. Inside it, each
 * tracker is a **program** — marching band, orchestra, choir — and the database's
 * word for that row is `ensemble`, which must never reach a user. "Band" is only
 * right when the program on screen actually is the band (its own name, or the
 * "Band Meeting" event type below). Event types are stored as lowercase keys and
 * rendered through the labels here (see docs/PLATFORM_PLAN.md §2.4 U2/U14).
 */

/** Full public name for the umbrella platform. */
export const PLATFORM_NAME = "Redmond High School Music & Arts Program Attendance";

/** Short UI / PWA name. */
export const APP_NAME = "RHS Music & Arts Attendance";

/** The umbrella, spelled out — welcome screen, About, the app bar's subtitle. */
export const ORG_NAME = "Redmond High School Music & Arts";

export const APP_DESCRIPTION =
  "The rehearsal calendar, attendance, and check-in tools for RHS musicians and their directors.";

export interface EventTypeOption {
  /** Canonical lowercase key stored in `events.event_type`. */
  value: string;
  label: string;
  /** Tailwind classes for the type chip. */
  chip: string;
}

const T = (
  value: string,
  label: string,
  chip: string
): EventTypeOption => ({ value, label, chip });

export const EVENT_TYPES: EventTypeOption[] = [
  T("rehearsal", "Rehearsal", "bg-band text-white"),
  T("concert", "Concert", "bg-ink text-white dark:bg-zinc-100 dark:text-zinc-900"),
  T("game", "Game", "bg-accent text-ink"),
  T("competition", "Competition", "bg-red-600 text-white"),
  T("performance", "Performance", "bg-purple-600 text-white"),
  T("section meeting", "Section Meeting", "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"),
  T("band meeting", "Band Meeting", "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"),
  T("general meeting", "General Meeting", "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"),
  T("parent meeting", "Parent Meeting", "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300"),
  T("fundraiser", "Fundraiser", "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"),
  T("event/activity", "Event / Activity", "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"),
  T("audition", "Audition", "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"),
  T("workshop", "Workshop", "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"),
  T("trip", "Trip", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"),
  T("other", "Other", "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"),
];

const BY_VALUE = new Map(EVENT_TYPES.map((t) => [t.value, t]));

/** Display label for any stored event type, including ones we don't know. */
export function eventTypeLabel(value: string | null | undefined): string {
  if (!value) return "Other";
  const key = value.trim().toLowerCase();
  return BY_VALUE.get(key)?.label ?? titleCase(value);
}

export function eventTypeChip(value: string | null | undefined): string {
  const key = (value ?? "").trim().toLowerCase();
  return BY_VALUE.get(key)?.chip ?? "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export const CHECKIN_MODE_LABEL: Record<CheckinMode, string> = {
  qr: "QR code + code",
  toggle: "Staff marks the roll",
  both: "QR code + staff marks",
  none: "No check-in",
};

export const ATTENDANCE_REQUIREMENT_LABEL: Record<AttendanceRequirement, string> = {
  required: "Required",
  optional: "Optional",
  none: "No attendance",
};

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  excused: "Excused",
  absent: "Absent",
};

export const ATTENDANCE_STATUS_CHIP: Record<AttendanceStatus, string> = {
  present: "bg-band text-white",
  late: "bg-accent text-ink",
  excused: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  absent: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

export const ROLE_LABEL: Record<Role, string> = {
  director: "Director",
  secretary: "Secretary",
  section_leader: "Section leader",
  student: "Student",
};

/**
 * Mirrors the mapping the calendar sync applies to synced events, so a manually
 * created event of the same type behaves the same way.
 */
export function defaultCheckinMode(type: string): CheckinMode {
  const t = type.trim().toLowerCase();
  if (
    ["rehearsal", "game", "concert", "competition", "performance"].includes(t)
  ) {
    return "qr";
  }
  return "toggle";
}

/** Attendance requirement follows the check-in mode: no mode = no attendance. */
export function defaultAttendanceRequirement(mode: CheckinMode): AttendanceRequirement {
  return mode === "none" ? "none" : "required";
}

/** Default site palette — also the fallback when a program stores no tokens. */
export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  primary: "#214d35",
  primaryDeep: "#173b28",
  accent: "#d5a33a",
  surface: "#faf9f4",
  ink: "#20241f",
};

export const CHECKIN_CODE_LENGTH = 8;

/**
 * Which audience the auth screens are speaking to — student or teacher.
 *
 * This is a preference for copy only: it survives a move between our own
 * sign-in and sign-up screens (which carry it in `?role=` and in session
 * storage) via session storage, and real roles (director, section leader,
 * student) still come from program membership after sign-in, never from this
 * choice.
 */
export type AuthAudience = "student" | "teacher";

const AUTH_AUDIENCE_KEY = "rhs:auth-audience";

export function readAuthAudience(): AuthAudience {
  try {
    return window.sessionStorage.getItem(AUTH_AUDIENCE_KEY) === "teacher"
      ? "teacher"
      : "student";
  } catch {
    /* private mode: fall back to the default copy */
    return "student";
  }
}

export function writeAuthAudience(audience: AuthAudience): void {
  try {
    window.sessionStorage.setItem(AUTH_AUDIENCE_KEY, audience);
  } catch {
    /* private mode: the choice just doesn't survive the session */
  }
}
