import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  QrCode,
  Search,
  StickyNote,
  Users,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Sheet,
  Skeleton,
  Textarea,
  Toggle,
  cn,
  useToast,
} from "../components/ui";
import { fetchAttendance, fetchEvents, fetchRoster, fetchStaffNotes } from "../lib/queries";
import { overrideAttendance } from "../lib/rpc";
import type { AttendanceRow, AttendanceStatus, EventRow, RosterMember } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import {
  ATTENDANCE_STATUS_CHIP,
  ATTENDANCE_STATUS_LABEL,
  eventTypeChip,
  eventTypeLabel,
} from "../lib/constants";
import { endOfDay, fmtTime, relativeDay, startOfDay } from "../lib/date";

/**
 * `/attendance` — the roll.
 *
 * One event, everyone in it, one tap per student. Passing the existing staff note
 * back through every status change matters: `override_attendance` replaces the
 * note wholesale, so saving a status with an empty note would silently erase it.
 */

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "excused", label: "Excused" },
  { value: "absent", label: "Absent" },
];

/** Closest to now first, and today always wins — that is the roll you mark. */
function rank(event: EventRow): number {
  const ms = Math.abs(new Date(event.date).getTime() - Date.now());
  const today = new Date(event.date).toDateString() === new Date().toDateString();
  return today ? ms - 1000 * 60 * 60 * 24 * 7 : ms;
}

export function AttendanceScreen() {
  const app = usePrograms();
  const navigate = useNavigate();
  const { toast } = useToast();
  const programId = app.program?.id ?? null;

  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [section, setSection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);

  const [editing, setEditing] = useState<RosterMember | null>(null);
  const [draftStatus, setDraftStatus] = useState<AttendanceStatus>("present");
  const [draftExcuse, setDraftExcuse] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyStudent, setBusyStudent] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulking, setBulking] = useState(false);

  const selected = useMemo(
    () => (events ?? []).find((e) => e.id === selectedId) ?? null,
    [events, selectedId]
  );

  // --- load the event list + the roster ------------------------------------
  const loadBase = useCallback(async () => {
    if (!programId) return;
    try {
      setError(null);
      const [list, people] = await Promise.all([fetchEvents(programId), fetchRoster(programId)]);
      setEvents(list);
      setRoster(people);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the roll.");
      setEvents([]);
      setRoster([]);
    }
  }, [programId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  // Pick a sensible default once, then leave the choice alone.
  useEffect(() => {
    if (selectedId || !events || events.length === 0) return;
    const sorted = [...events].sort((a, b) => rank(a) - rank(b));
    setSelectedId(sorted[0].id);
  }, [events, selectedId]);

  // --- load that event's attendance ---------------------------------------
  const loadAttendance = useCallback(async () => {
    if (!programId || !selected) {
      setAttendance([]);
      setNotes(new Map());
      return;
    }
    try {
      const rows = await fetchAttendance(programId, {
        from: startOfDay(selected.date).toISOString(),
        to: endOfDay(selected.date).toISOString(),
      });
      const mine = rows.filter((r) => r.event_id === selected.id);
      setAttendance(mine);

      const noteRows = await fetchStaffNotes(mine.map((r) => r.id));
      const map = new Map<string, string>();
      for (const n of noteRows) map.set(n.attendance_record_id, n.staff_note);
      setNotes(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this event's marks.");
      setAttendance([]);
      setNotes(new Map());
    }
  }, [programId, selected]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  // --- derived -------------------------------------------------------------
  // Only people who are actually in the band take the roll — someone a director
  // removed must not sit in the denominator as "not marked" forever.
  const students = useMemo(
    () =>
      (roster ?? [])
        .filter((m) => m.active && !m.roles.includes("director"))
        .sort((a, b) =>
          a.section_name === b.section_name
            ? (a.profile.display_name || a.profile.full_name).localeCompare(
                b.profile.display_name || b.profile.full_name
              )
            : a.section_name.localeCompare(b.section_name)
        ),
    [roster]
  );

  const byStudent = useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    for (const a of attendance) map.set(a.student_id, a);
    return map;
  }, [attendance]);

  const counts = useMemo(() => {
    let present = 0;
    let late = 0;
    let excused = 0;
    for (const s of students) {
      const row = byStudent.get(s.user_id);
      if (!row) continue;
      if (row.status === "present") present += 1;
      else if (row.status === "late") late += 1;
      else if (row.status === "excused") excused += 1;
    }
    const marked = present + late + excused;
    return { present, late, excused, marked, unmarked: Math.max(0, students.length - marked) };
  }, [students, byStudent]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (section !== "all" && (s.section_name || "none") !== section) return false;
      if (onlyUnmarked && byStudent.has(s.user_id)) return false;
      if (!q) return true;
      return (
        s.profile.full_name.toLowerCase().includes(q) ||
        s.profile.display_name.toLowerCase().includes(q)
      );
    });
  }, [students, section, onlyUnmarked, query, byStudent]);

  const sectionChips = useMemo(() => {
    const countsBySection = new Map<string, number>();
    for (const s of students) {
      const key = s.section_name || "none";
      countsBySection.set(key, (countsBySection.get(key) ?? 0) + 1);
    }
    const chips = app.sections
      .map((sec) => ({ key: sec.name, label: sec.name, n: countsBySection.get(sec.name) ?? 0 }))
      .filter((c) => c.n > 0);
    if ((countsBySection.get("none") ?? 0) > 0) {
      chips.push({ key: "none", label: "No section", n: countsBySection.get("none") ?? 0 });
    }
    return chips;
  }, [students, app.sections]);

  // --- writes --------------------------------------------------------------
  const existingNote = useCallback(
    (studentId: string) => {
      const row = byStudent.get(studentId);
      return row ? (notes.get(row.id) ?? "") : "";
    },
    [byStudent, notes]
  );

  async function mark(
    studentId: string,
    status: AttendanceStatus,
    excuse = "",
    note = ""
  ): Promise<boolean> {
    if (!selected) return false;
    const { result, error: rpcError } = await overrideAttendance(
      selected.id,
      studentId,
      status,
      excuse,
      note
    );
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not save that mark.");
      return false;
    }
    return true;
  }

  /** One-tap present — keeps any staff note that was already there. */
  async function quickPresent(student: RosterMember) {
    setBusyStudent(student.user_id);
    const ok = await mark(student.user_id, "present", "", existingNote(student.user_id));
    setBusyStudent(null);
    if (ok) await loadAttendance();
  }

  function openEditor(student: RosterMember) {
    const row = byStudent.get(student.user_id);
    setEditing(student);
    setDraftStatus(row?.status ?? "present");
    setDraftExcuse(row?.excuse_reason ?? "");
    setDraftNote(row ? (notes.get(row.id) ?? "") : "");
  }

  async function saveEditor() {
    if (!editing) return;
    setSaving(true);
    const ok = await mark(
      editing.user_id,
      draftStatus,
      draftStatus === "excused" ? draftExcuse : "",
      draftNote
    );
    setSaving(false);
    if (!ok) return;
    setEditing(null);
    toast.success("Saved.");
    await loadAttendance();
  }

  async function markAllRemaining() {
    if (!selected) return;
    const remaining = students.filter((s) => !byStudent.has(s.user_id));
    setBulking(true);
    let failed = 0;
    for (const student of remaining) {
      const ok = await mark(student.user_id, "present");
      if (!ok) failed += 1;
    }
    setBulking(false);
    setBulkOpen(false);
    await loadAttendance();
    if (failed > 0) {
      toast.warn(`Marked ${remaining.length - failed} present — ${failed} wouldn't save.`);
    } else {
      toast.success(`Marked ${remaining.length} present.`);
    }
  }

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const pct = students.length ? Math.round((counts.marked / students.length) * 100) : 0;

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {app.isSectionLeader && !app.isDirector && !app.isSecretary ? (
        <Alert tone="info">
          You can mark the students in your own section. Everyone else is read-only for you.
        </Alert>
      ) : null}

      {/* --- which event --- */}
      {events === null ? (
        <Skeleton className="h-20 w-full" />
      ) : events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="No events to mark yet"
            body="Add a rehearsal or game on the Calendar screen and the roll shows up here."
            action={
              <Button variant="secondary" onClick={() => navigate("/calendar")}>
                Open the calendar
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-black/5 transition-colors hover:bg-black/[0.03] dark:bg-zinc-900 dark:ring-white/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
              <ClipboardList className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {selected?.name ?? "Choose an event"}
              </span>
              <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                {selected
                  ? `${relativeDay(selected.date)} · ${
                      selected.all_day ? "All day" : fmtTime(selected.date)
                    } · ${eventTypeLabel(selected.event_type)}`
                  : "Tap to pick the event you're taking attendance for"}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
          </button>

          {selected && selected.checkin_mode !== "none" && selected.checkin_mode !== "toggle" ? (
            <Button
              block
              variant="secondary"
              icon={<QrCode className="h-4 w-4" />}
              onClick={() => navigate(`/checkin?event=${selected.id}`)}
            >
              Let students scan instead
            </Button>
          ) : null}
        </>
      )}

      {/* --- today's numbers --- */}
      {selected ? (
        <Card className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-extrabold tabular-nums">
                {counts.marked}
                <span className="text-lg text-zinc-400"> / {students.length}</span>
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">marked</p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {counts.present > 0 ? (
                <Badge className={ATTENDANCE_STATUS_CHIP.present}>{counts.present} present</Badge>
              ) : null}
              {counts.late > 0 ? (
                <Badge className={ATTENDANCE_STATUS_CHIP.late}>{counts.late} late</Badge>
              ) : null}
              {counts.excused > 0 ? (
                <Badge className={ATTENDANCE_STATUS_CHIP.excused}>{counts.excused} excused</Badge>
              ) : null}
              {counts.unmarked > 0 ? (
                <Badge className="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {counts.unmarked} not marked
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-full rounded-full bg-band transition-all" style={{ width: `${pct}%` }} />
          </div>
        </Card>
      ) : null}

      {/* --- filters --- */}
      {students.length > 0 ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a student"
              aria-label="Find a student"
            />
          </div>

          {sectionChips.length > 1 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSection("all")}
                className={cn(
                  "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors",
                  section === "all"
                    ? "bg-band text-white"
                    : "bg-black/[0.05] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300"
                )}
              >
                All ({students.length})
              </button>
              {sectionChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSection(c.key)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors",
                    section === c.key
                      ? "bg-band text-white"
                      : "bg-black/[0.05] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300"
                  )}
                >
                  {c.label} ({c.n})
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-1.5 ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
            <span className="text-sm font-semibold">Only students without a mark</span>
            <Toggle
              checked={onlyUnmarked}
              onChange={setOnlyUnmarked}
              label="Only students without a mark"
            />
          </div>
        </div>
      ) : null}

      {/* --- the list --- */}
      {roster === null ? (
        <Skeleton className="h-64 w-full" />
      ) : students.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Nobody on the roster yet"
            body="Once students join, they show up here ready to be marked."
            action={
              <Button variant="secondary" onClick={() => navigate("/roster")}>
                Open the roster
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Check className="h-6 w-6" />}
            title="Nothing left here"
            body="Everyone matching your search already has a mark."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          {visible.map((student) => {
            const row = byStudent.get(student.user_id);
            const name = student.profile.display_name || student.profile.full_name;
            const note = row ? notes.get(row.id) : undefined;
            return (
              <div key={student.user_id} className="flex items-center gap-2 py-1">
                <button
                  type="button"
                  onClick={() => openEditor(student)}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <Avatar name={name} url={student.profile.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="flex items-center gap-1.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {student.section_name || "No section"}
                      {note ? <StickyNote className="h-3.5 w-3.5 shrink-0" /> : null}
                    </span>
                  </span>
                </button>

                {row ? (
                  <Badge className={cn("shrink-0", ATTENDANCE_STATUS_CHIP[row.status])}>
                    {ATTENDANCE_STATUS_LABEL[row.status]}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyStudent === student.user_id}
                    icon={<Check className="h-4 w-4" />}
                    onClick={() => void quickPresent(student)}
                  >
                    Present
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {counts.unmarked > 0 && students.length > 0 ? (
        <Button
          block
          variant="accent"
          icon={<CheckCircle2 className="h-4 w-4" />}
          onClick={() => setBulkOpen(true)}
        >
          Mark the other {counts.unmarked} present
        </Button>
      ) : null}

      {selected && roster && students.length > 0 ? (
        <p className="px-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Absent students are simply left unmarked — the event counts against them.
        </p>
      ) : null}

      {/* --- event picker --- */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Which event?" size="tall">
        {events && events.length > 0 ? (
          <ul className="space-y-1">
            {[...events]
              .sort((a, b) => rank(a) - rank(b))
              .map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(e.id);
                      setPickerOpen(false);
                    }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.name}</span>
                      <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {relativeDay(e.date)} · {e.all_day ? "All day" : fmtTime(e.date)} ·{" "}
                        {eventTypeLabel(e.event_type)}
                      </span>
                    </span>
                    <Badge className={cn("shrink-0", eventTypeChip(e.event_type))}>
                      {eventTypeLabel(e.event_type)}
                    </Badge>
                  </button>
                </li>
              ))}
          </ul>
        ) : (
          <EmptyState title="No events yet" body="Add one on the calendar first." />
        )}
      </Sheet>

      {/* --- one student --- */}
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? editing.profile.display_name || editing.profile.full_name : "Student"}
        description={editing?.section_name || "No section"}
        footer={
          <>
            <Button variant="secondary" block onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button block loading={saving} onClick={() => void saveEditor()}>
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Attendance">
              <SegmentedControl
                className="flex-wrap"
                value={draftStatus}
                onChange={setDraftStatus}
                options={STATUS_OPTIONS}
              />
            </Field>

            {draftStatus === "excused" ? (
              <Field label="Why excused?" hint="Shown to the director; excused absences don't count against them.">
                <Textarea
                  value={draftExcuse}
                  onChange={(e) => setDraftExcuse(e.target.value)}
                  placeholder="Doctor's appointment"
                />
              </Field>
            ) : null}

            <Field
              label="Staff note"
              hint="Only directors, secretaries and section leaders can read this — students never see it."
            >
              <Textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="Talked to them about being late."
              />
            </Field>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Choosing Absent removes any record for this event, so it counts as a miss.
            </p>
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={bulkOpen}
        title="Mark everyone present?"
        body={`Every student who has no mark yet (${counts.unmarked}) will be marked present for this event. You can still change anyone afterwards.`}
        confirmLabel="Mark present"
        tone="accent"
        loading={bulking}
        onCancel={() => setBulkOpen(false)}
        onConfirm={() => void markAllRemaining()}
      />
    </div>
  );
}
