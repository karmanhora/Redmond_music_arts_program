/** Date helpers shared by the calendar, attendance and event screens. */

/** Midnight of the day `d` falls on. Accepts a Date or an ISO string, because
 * half the call sites hold an ISO stamp straight from the database. */
export function startOfDay(d: Date | string): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** The last millisecond of the day `d` falls on. */
export function endOfDay(d: Date | string): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Sunday-first matrix of weeks for a month; null = a cell outside the month. */
export function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function fmtTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateTime(iso: string, allDay = false): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return allDay ? `${date} · All day` : `${date} · ${fmtTime(iso)}`;
}

/** "Today", "Tomorrow", "Yesterday", or "Thu, Sep 3". */
export function relativeDay(iso: string): string {
  const d = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDate(d);
}

/** "in 25 min" / "in 2 h" / "3 days ago" — for the home screen's next event. */
export function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const mins = Math.round(ms / 60_000);
  if (Math.abs(mins) < 1) return "now";
  if (mins > 0) {
    if (mins < 60) return `in ${mins} min`;
    if (mins < 60 * 24) return `in ${Math.round(mins / 60)} h`;
    return `in ${Math.round(mins / (60 * 24))} days`;
  }
  const abs = Math.abs(mins);
  if (abs < 60) return `${abs} min ago`;
  if (abs < 60 * 24) return `${Math.round(abs / 60)} h ago`;
  return `${Math.round(abs / (60 * 24))} days ago`;
}

/** Countdown for the live check-in screen: "4:32". */
export function mmss(untilIso: string, now = Date.now()): string {
  const total = Math.max(0, Math.round((new Date(untilIso).getTime() - now) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * "Add to Google Calendar" deep link — no API key needed. Opens the Calendar
 * app on mobile or calendar.google.com on desktop. Defaults to one hour long.
 */
export function googleCalendarUrl(opts: {
  name: string;
  date: string;
  endDate?: string | null;
  location?: string;
  details?: string;
  allDay?: boolean;
}): string {
  const start = new Date(opts.date);
  const end = opts.endDate
    ? new Date(opts.endDate)
    : new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dates = opts.allDay
    ? `${fmt(start).slice(0, 8)}/${fmt(end).slice(0, 8)}`
    : `${fmt(start)}/${fmt(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.name,
    dates,
    location: opts.location ?? "",
    details: opts.details ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Pull a check-in token out of whatever the QR scanner decoded. QR codes in the
 * wild are `/checkin?token=…` URLs, but a plain token is accepted too.
 */
export function parseTokenFromString(decoded: string): string | null {
  const trimmed = decoded.trim();
  try {
    if (trimmed.includes("token=")) {
      const url = new URL(trimmed, window.location.origin);
      const token = url.searchParams.get("token");
      if (token) return token;
    }
  } catch {
    /* not a URL — fall through and treat it as a bare token */
  }
  return /^[a-f0-9]{16,}$/i.test(trimmed) ? trimmed : null;
}
