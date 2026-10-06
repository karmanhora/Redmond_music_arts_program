import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  Input,
  Row,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Textarea,
  Toggle,
  cn,
  useToast,
} from "../components/ui";
import {
  createPersonalEvent,
  deleteEvent,
  deletePersonalEvent,
  fetchEvents,
  fetchPersonalEvents,
  insertEvent,
  setEventArchived,
  updateEvent,
} from "../lib/queries";
import type { EventDraft } from "../lib/queries";
import type {
  AttendanceRequirement,
  CheckinMode,
  EventRow,
  PersonalEventRow,
} from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import {
  ATTENDANCE_REQUIREMENT_LABEL,
  CHECKIN_MODE_LABEL,
  EVENT_TYPES,
  defaultAttendanceRequirement,
  defaultCheckinMode,
  eventTypeChip,
  eventTypeLabel,
} from "../lib/constants";
import {
  addMonths,
  endOfDay,
  fmtDate,
  fmtMonthYear,
  fmtTime,
  googleCalendarUrl,
  isSameDay,
  monthMatrix,
  relativeDay,
  startOfDay,
} from "../lib/date";

/**
 * `/calendar` — the month the old app opened on, plus the agenda that answers
 * "what am I doing that day?".
 *
 * Students see their program's schedule and their own private reminders. Staff also
 * get the event form (add, edit, archive) — the same fields the calendar sync
 * writes, so a hand-made rehearsal and a synced one behave identically.
 */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** `<input type="date">` wants yyyy-mm-dd in *local* time, never an ISO stamp. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeKey(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Local wall-clock date + time → the ISO instant the database stores.
 *
 * Returns null rather than throwing when someone clears the date or time input:
 * a half-filled native input yields NaN, and `toISOString()` on an Invalid Date
 * would blow up mid-save instead of telling the director what is missing.
 */
function isoFrom(dateStr: string, timeStr: string, allDay: boolean): string | null {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = (allDay ? "00:00" : timeStr || "00:00").split(":").map(Number);
  if (!year || !month || !day || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

interface FormState {
  id: string | null;
  name: string;
  event_type: string;
  date: string;
  time: string;
  endTime: string;
  all_day: boolean;
  location: string;
  description: string;
  checkin_mode: CheckinMode;
  attendance_requirement: AttendanceRequirement;
  late_minutes: string;
  /** UI-only: once someone chooses a mode by hand, stop deriving it from type. */
  modeTouched: boolean;
  requirementTouched: boolean;
}

function newForm(day: Date): FormState {
  const mode = defaultCheckinMode("rehearsal");
  return {
    id: null,
    name: "",
    event_type: "rehearsal",
    date: dateKey(day),
    time: "16:00",
    endTime: "",
    all_day: false,
    location: "",
    description: "",
    checkin_mode: mode,
    attendance_requirement: defaultAttendanceRequirement(mode),
    late_minutes: "0",
    modeTouched: false,
    requirementTouched: false,
  };
}

function formFromEvent(e: EventRow): FormState {
  return {
    id: e.id,
    name: e.name,
    event_type: e.event_type || e.type,
    date: dateKey(new Date(e.date)),
    time: timeKey(e.date),
    endTime: e.end_date ? timeKey(e.end_date) : "",
    all_day: e.all_day,
    location: e.location,
    description: e.description,
    checkin_mode: e.checkin_mode,
    attendance_requirement: e.attendance_requirement,
    late_minutes: String(e.late_minutes),
    modeTouched: true,
    requirementTouched: true,
  };
}

const MODE_OPTIONS = (Object.keys(CHECKIN_MODE_LABEL) as CheckinMode[]).map((m) => ({
  value: m,
  label: CHECKIN_MODE_LABEL[m],
}));

const REQUIREMENT_OPTIONS = (
  Object.keys(ATTENDANCE_REQUIREMENT_LABEL) as AttendanceRequirement[]
).map((r) => ({ value: r, label: ATTENDANCE_REQUIREMENT_LABEL[r] }));

export function CalendarScreen() {
  const app = usePrograms();
  const { toast } = useToast();
  const programId = app.program?.id ?? null;
  const profileId = app.profile?.id ?? null;

  const today = useMemo(() => startOfDay(new Date()), []);
  const [cursor, setCursor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<Date>(today);

  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [personal, setPersonal] = useState<PersonalEventRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<EventRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "event" | "personal"; id: string; name: string } | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reminder, setReminder] = useState("");

  /** The grid shows a few days either side so a month never looks empty.
   * (Deliberately not named `window`: that would shadow the global one.) */
  const range = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const from = new Date(first);
    from.setDate(from.getDate() - 7);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const to = new Date(last);
    to.setDate(to.getDate() + 7);
    return { from: startOfDay(from).toISOString(), to: endOfDay(to).toISOString() };
  }, [cursor]);

  const load = useCallback(async () => {
    if (!programId) return;
    try {
      setError(null);
      const [list, mine] = await Promise.all([
        fetchEvents(programId, {
          from: range.from,
          to: range.to,
          includeArchived: showArchived,
        }),
        fetchPersonalEvents(),
      ]);
      setEvents(list);
      setPersonal(mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the calendar.");
      setEvents([]);
    }
  }, [programId, range.from, range.to, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events ?? []) {
      const key = dateKey(new Date(e.date));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    return map;
  }, [events]);

  const personalByDay = useMemo(() => {
    const map = new Map<string, PersonalEventRow[]>();
    for (const p of personal) {
      const key = dateKey(new Date(p.date));
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [personal]);

  const weeks = useMemo(() => monthMatrix(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const dayEvents = byDay.get(dateKey(selectedDay)) ?? [];
  const dayPersonal = personalByDay.get(dateKey(selectedDay)) ?? [];
  const isThisMonth =
    cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth();

  async function saveForm() {
    if (!form || !programId || !profileId) return;
    if (!form.name.trim()) {
      setFormError("Give the event a name.");
      return;
    }
    const startIso = isoFrom(form.date, form.time, form.all_day);
    if (!startIso) {
      setFormError(
        form.all_day ? "Pick a date." : "Pick a date and a start time."
      );
      return;
    }
    const draft: EventDraft = {
      name: form.name.trim(),
      event_type: form.event_type,
      date: startIso,
      end_date:
        form.all_day || !form.endTime ? null : isoFrom(form.date, form.endTime, false),
      all_day: form.all_day,
      location: form.location.trim(),
      description: form.description.trim(),
      checkin_mode: form.checkin_mode,
      attendance_requirement: form.attendance_requirement,
      late_minutes: Number(form.late_minutes) || 0,
    };

    setSaving(true);
    setFormError(null);
    const editing = Boolean(form.id);
    const { error: writeError } = editing
      ? await updateEvent(form.id as string, draft)
      : await insertEvent(programId, profileId, draft);
    setSaving(false);

    if (writeError) {
      setFormError(writeError.message);
      return;
    }
    setForm(null);
    toast.success(editing ? "Event updated." : "Event added.");
    await load();
  }

  async function toggleArchived(event: EventRow) {
    setBusyId(event.id);
    const { error: writeError } = await setEventArchived(event.id, !event.archived);
    setBusyId(null);
    if (writeError) {
      toast.error(writeError.message);
      return;
    }
    toast.success(event.archived ? "Event restored." : "Event archived.");
    setDetail(null);
    await load();
  }

  async function removeConfirmed() {
    if (!confirm) return;
    setBusyId(confirm.id);
    if (confirm.kind === "personal") {
      await deletePersonalEvent(confirm.id);
    } else {
      const { error: writeError } = await deleteEvent(confirm.id);
      if (writeError) {
        setBusyId(null);
        toast.error(writeError.message);
        setConfirm(null);
        return;
      }
    }
    setBusyId(null);
    setConfirm(null);
    setDetail(null);
    toast.success("Deleted.");
    await load();
  }

  async function addReminder() {
    if (!profileId || !reminder.trim()) return;
    const { error: writeError } = await createPersonalEvent({
      owner_id: profileId,
      name: reminder.trim(),
      date: startOfDay(selectedDay).toISOString(),
    });
    if (writeError) {
      toast.error(writeError.message);
      return;
    }
    setReminder("");
    toast.success("Added to your own calendar.");
    await load();
  }

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --- month header --- */}
      <div className="flex items-center gap-2">
        <IconButton
          label="Previous month"
          icon={<ChevronLeft className="h-5 w-5" />}
          onClick={() => setCursor((c) => addMonths(c, -1))}
        />
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-bold">{fmtMonthYear(cursor.getFullYear(), cursor.getMonth())}</p>
          {!isThisMonth ? (
            <button
              type="button"
              className="text-xs font-semibold text-band underline dark:text-emerald-300"
              onClick={() => {
                setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelectedDay(today);
              }}
            >
              Back to today
            </button>
          ) : null}
        </div>
        <IconButton
          label="Next month"
          icon={<ChevronRight className="h-5 w-5" />}
          onClick={() => setCursor((c) => addMonths(c, 1))}
        />
        {app.isStaff ? (
          <Button
            size="sm"
            icon={<CalendarPlus className="h-4 w-4" />}
            onClick={() => {
              setFormError(null);
              setForm(newForm(selectedDay));
            }}
          >
            Add
          </Button>
        ) : null}
      </div>

      {/* --- the grid --- */}
      <Card className="p-2">
        <div className="grid grid-cols-7 pb-1">
          {WEEKDAYS.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="text-center text-[11px] font-bold text-zinc-400 uppercase"
            >
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {weeks.flatMap((week, wi) =>
            week.map((day, di) => {
              if (!day) return <span key={`${wi}-${di}`} className="min-h-13" />;
              const key = dateKey(day);
              const list = byDay.get(key) ?? [];
              const mine = personalByDay.get(key) ?? [];
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDay);
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={fmtDate(day)}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => setSelectedDay(startOfDay(day))}
                  className={cn(
                    "flex min-h-13 flex-col items-center justify-start gap-1 rounded-xl px-0.5 pt-1.5 transition-colors",
                    isSelected
                      ? "bg-band text-white"
                      : isToday
                        ? "bg-band/10 text-band-deep dark:bg-band/25 dark:text-emerald-200"
                        : "hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
                  )}
                >
                  <span className={cn("text-sm font-semibold", isToday && !isSelected && "font-extrabold")}>
                    {day.getDate()}
                  </span>
                  <span className="flex h-1.5 items-center gap-0.5">
                    {list.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isSelected ? "bg-white" : eventTypeChip(e.event_type)
                        )}
                      />
                    ))}
                    {mine.length > 0 && list.length === 0 ? (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full ring-1",
                          isSelected ? "bg-white/70 ring-white" : "bg-zinc-400 ring-zinc-400"
                        )}
                      />
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Card>

      {app.isStaff ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-1 ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
          <span className="text-sm font-semibold">Show archived events</span>
          <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived events" />
        </div>
      ) : null}

      {/* --- agenda for the chosen day --- */}
      <div className="space-y-2">
        <p className="px-1 text-xs font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
          {relativeDay(selectedDay.toISOString())}
        </p>

        {events === null ? (
          <Skeleton className="h-24 w-full" />
        ) : dayEvents.length === 0 && dayPersonal.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Nothing on this day"
              body={
                app.isStaff
                  ? "Tap Add to put a rehearsal, game or meeting on the schedule."
                  : "Enjoy the quiet — or check another day."
              }
            />
          </Card>
        ) : (
          <Card className="space-y-3">
            {dayEvents.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setDetail(e)}
                className="flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <span className="mt-0.5 flex w-14 shrink-0 flex-col items-center">
                  <span className="text-sm font-bold">
                    {e.all_day ? "All day" : fmtTime(e.date)}
                  </span>
                  {!e.all_day && e.end_date ? (
                    <span className="text-[11px] text-zinc-400">{fmtTime(e.end_date)}</span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge className={eventTypeChip(e.event_type)}>
                      {eventTypeLabel(e.event_type)}
                    </Badge>
                    {e.archived ? <Badge className="bg-zinc-200 text-zinc-600">Archived</Badge> : null}
                  </span>
                  <span className="mt-1 block truncate font-semibold">{e.name}</span>
                  {e.location ? (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {e.location}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}

            {dayPersonal.length > 0 ? (
              <div className="space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                <p className="text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
                  Your own reminders
                </p>
                {dayPersonal.map((p) => (
                  <Row
                    key={p.id}
                    icon={<Clock className="h-5 w-5" />}
                    title={p.name}
                    subtitle={p.location || "Private to you"}
                    trailing={
                      <IconButton
                        label={`Delete ${p.name}`}
                        variant="ghost"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setConfirm({ kind: "personal", id: p.id, name: p.name })}
                      />
                    }
                  />
                ))}
              </div>
            ) : null}
          </Card>
        )}

        {profileId ? (
          <Card className="space-y-2">
            <p className="text-sm font-semibold">Add your own reminder</p>
            <div className="flex items-end gap-2">
              <Field className="flex-1">
                <Input
                  value={reminder}
                  onChange={(e) => setReminder(e.target.value)}
                  placeholder="Percussion practice"
                  aria-label="Your own reminder"
                />
              </Field>
              <Button
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                disabled={!reminder.trim()}
                onClick={() => void addReminder()}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Only you can see it, and it never affects attendance.
            </p>
          </Card>
        ) : null}
      </div>

      {/* --- event detail --- */}
      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? "Event"}
        description={detail ? eventTypeLabel(detail.event_type) : undefined}
      >
        {detail ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="flex items-center gap-2 font-semibold">
                <Clock className="h-4 w-4 shrink-0 text-zinc-400" />
                {relativeDay(detail.date)} ·{" "}
                {detail.all_day ? "All day" : fmtTime(detail.date)}
                {!detail.all_day && detail.end_date ? ` – ${fmtTime(detail.end_date)}` : ""}
              </p>
              {detail.location ? (
                <p className="flex items-center gap-2 font-semibold">
                  <MapPin className="h-4 w-4 shrink-0 text-zinc-400" />
                  {detail.location}
                </p>
              ) : null}
              {detail.description ? (
                <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                  {detail.description}
                </p>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/[0.06]">
              <div>
                <dt className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Check-in</dt>
                <dd className="mt-0.5 font-medium">{CHECKIN_MODE_LABEL[detail.checkin_mode]}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Attendance</dt>
                <dd className="mt-0.5 font-medium">
                  {ATTENDANCE_REQUIREMENT_LABEL[detail.attendance_requirement]}
                </dd>
              </div>
              {detail.event_source === "google_calendar" ? (
                <div className="col-span-2">
                  <dt className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Source</dt>
                  <dd className="mt-0.5 font-medium">Synced from the school calendar</dd>
                </div>
              ) : null}
            </dl>

            <Button
              block
              variant="secondary"
              onClick={() =>
                window.open(
                  googleCalendarUrl({
                    name: detail.name,
                    date: detail.date,
                    endDate: detail.end_date,
                    location: detail.location,
                    details: detail.description,
                    allDay: detail.all_day,
                  }),
                  "_blank",
                  "noopener"
                )
              }
            >
              Add to Google Calendar
            </Button>

            {app.isStaff ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    block
                    variant="secondary"
                    icon={<Pencil className="h-4 w-4" />}
                    onClick={() => {
                      setFormError(null);
                      setForm(formFromEvent(detail));
                      setDetail(null);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    block
                    variant="secondary"
                    loading={busyId === detail.id}
                    icon={
                      detail.archived ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )
                    }
                    onClick={() => void toggleArchived(detail)}
                  >
                    {detail.archived ? "Restore" : "Archive"}
                  </Button>
                </div>
                {app.isDirector ? (
                  <Button
                    block
                    variant="danger"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() =>
                      setConfirm({ kind: "event", id: detail.id, name: detail.name })
                    }
                  >
                    Delete event
                  </Button>
                ) : (
                  <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                    Archiving hides it from the program; only a director can delete it.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* --- add / edit form (staff) --- */}
      <Sheet
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Edit event" : "Add event"}
        description="Everyone in this program gets a notification when you save."
        size="tall"
        footer={
          <>
            <Button variant="secondary" block onClick={() => setForm(null)} disabled={saving}>
              Cancel
            </Button>
            <Button block loading={saving} onClick={() => void saveForm()}>
              {form?.id ? "Save changes" : "Add event"}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="space-y-4">
            {formError ? <Alert tone="error">{formError}</Alert> : null}

            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Tuesday rehearsal"
              />
            </Field>

            <Field label="Type">
              <Select
                value={form.event_type}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((f) => {
                    if (!f) return f;
                    const mode = f.modeTouched ? f.checkin_mode : defaultCheckinMode(next);
                    return {
                      ...f,
                      event_type: next,
                      checkin_mode: mode,
                      attendance_requirement: f.requirementTouched
                        ? f.attendance_requirement
                        : defaultAttendanceRequirement(mode),
                    };
                  });
                }}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.06]">
              <span className="text-sm font-semibold">All day</span>
              <Toggle
                checked={form.all_day}
                onChange={(next) => setForm({ ...form, all_day: next })}
                label="All day"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </Field>
              {form.all_day ? null : (
                <Field label="Starts">
                  <Input
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </Field>
              )}
            </div>

            {form.all_day ? null : (
              <Field label="Ends" hint="Leave empty if you don't know — it's optional.">
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </Field>
            )}

            <Field label="Location">
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Rehearsal room"
              />
            </Field>

            <Field label="Details" hint="Shown when someone taps the event.">
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Bring your marching shoes."
              />
            </Field>

            <Field label="How do students check in?">
              <SegmentedControl
                className="flex-wrap"
                value={form.checkin_mode}
                onChange={(mode) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          checkin_mode: mode,
                          modeTouched: true,
                          attendance_requirement: f.requirementTouched
                            ? f.attendance_requirement
                            : defaultAttendanceRequirement(mode),
                        }
                      : f
                  )
                }
                options={MODE_OPTIONS}
              />
            </Field>

            <Field label="Attendance">
              <SegmentedControl
                value={form.attendance_requirement}
                onChange={(r) =>
                  setForm((f) => (f ? { ...f, attendance_requirement: r, requirementTouched: true } : f))
                }
                options={REQUIREMENT_OPTIONS}
              />
            </Field>

            <Field
              label="Counts as late after"
              hint="Minutes past the start time. 0 turns late marking off."
            >
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={form.late_minutes}
                onChange={(e) => setForm({ ...form, late_minutes: e.target.value })}
              />
            </Field>

            {form.attendance_requirement === "required" && form.checkin_mode === "qr" ? (
              <Alert tone="info">
                Students scan the code you project from the Check in screen. Their percentage only
                counts events marked Required.
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={confirm !== null}
        title={confirm?.kind === "personal" ? "Delete your reminder?" : "Delete this event?"}
        body={
          confirm?.kind === "personal"
            ? `“${confirm?.name}” will be removed from your calendar.`
            : `“${confirm?.name}” and its attendance records will be deleted for good. Archiving keeps the history — that's usually what you want.`
        }
        confirmLabel="Delete"
        loading={busyId !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeConfirmed()}
      />
    </div>
  );
}
