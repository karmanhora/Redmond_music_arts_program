import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Music,
  QrCode,
  Users,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressRing,
  Row,
  SectionTitle,
  Skeleton,
  cn,
} from "../components/ui";
import { fetchAttendance, fetchEvents } from "../lib/queries";
import type { EmbeddedMembership } from "../lib/queries";
import { getMyAttendancePct, getMyAttendanceTrend } from "../lib/rpc";
import type { EventRow, MyAttendanceRow } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import {
  APP_DESCRIPTION,
  ATTENDANCE_REQUIREMENT_LABEL,
  ATTENDANCE_STATUS_CHIP,
  ATTENDANCE_STATUS_LABEL,
  eventTypeLabel,
} from "../lib/constants";
import { endOfDay, fmtTime, isSameDay, relativeDay, startOfDay, untilLabel } from "../lib/date";

const FUTURE_PROGRAMS = ["Orchestra", "Choir", "Drama"];

/**
 * Signed-in student dashboard. It keeps the existing Band implementation alive
 * below the same routes, but frames it as one program inside the larger hub.
 */
export function HomeScreen() {
  const app = usePrograms();
  const navigate = useNavigate();

  const programId = app.program?.id ?? null;
  const profileId = app.profile?.id ?? null;

  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<MyAttendanceRow[]>([]);
  const [checkedInEventId, setCheckedInEventId] = useState<string | null>(null);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [percentage, setPercentage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!programId) return;
    try {
      setError(null);
      const list = await fetchEvents(programId);
      setEvents(list);

      const [todayAttendance, myPct, myTrend] = await Promise.all([
        profileId
          ? fetchAttendance(programId, {
              from: startOfDay(new Date()).toISOString(),
              to: endOfDay(new Date()).toISOString(),
            })
          : Promise.resolve([]),
        getMyAttendancePct(programId),
        getMyAttendanceTrend(programId, 6),
      ]);

      const mine = todayAttendance.find((r) => r.student_id === profileId) ?? null;
      setCheckedInEventId(mine?.event_id ?? null);
      setCheckedInAt(mine?.checked_in_at ?? null);

      setPercentage(
        myPct.result?.ok && typeof myPct.result.percentage === "number"
          ? myPct.result.percentage
          : null
      );
      setAttendanceRows(myTrend.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, [programId, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const now = Date.now();
  const firstName =
    (app.profile?.display_name || app.profile?.full_name || "there").split(/\s+/)[0] ?? "there";

  const todayEvent = useMemo(
    () => events?.find((e) => isSameDay(new Date(e.date), new Date())) ?? null,
    [events]
  );

  const upcoming = useMemo(
    () => (events ?? []).filter((e) => new Date(e.date).getTime() >= now).slice(0, 4),
    [events, now]
  );

  const nextEvent = todayEvent ?? upcoming[0] ?? null;

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="rounded-2xl bg-zinc-950 p-5 text-white shadow-sm dark:bg-zinc-900">
        <p className="text-xs font-bold tracking-widest text-amber-200 uppercase">
          RHS Music & Arts Attendance
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Welcome back, {firstName}</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/75">{APP_DESCRIPTION}</p>
      </section>

      <section id="my-programs" className="space-y-2">
        <SectionTitle>My Programs</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {app.memberships.map((m) => (
            <ProgramCard
              key={m.id}
              membership={m}
              current={m.ensemble.id === app.program?.id}
              onOpen={() => {
                app.setProgram(m.ensemble.id);
                navigate("/");
              }}
            />
          ))}
          {FUTURE_PROGRAMS.map((name) => (
            <FutureProgramCard key={name} name={name} />
          ))}
        </div>
      </section>

      {loading && !events ? (
        <>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </>
      ) : nextEvent ? (
        <HeroEventCard
          event={nextEvent}
          isToday={nextEvent.id === todayEvent?.id}
          alreadyCheckedIn={checkedInEventId === nextEvent.id}
          checkedInAt={checkedInAt}
          onCheckIn={() => navigate("/checkin")}
          onStartCheckIn={() => navigate(`/checkin?event=${nextEvent.id}`)}
          onMarkAttendance={() => navigate("/attendance")}
          isStaff={app.isStaff}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<Music className="h-6 w-6" />}
            title="No upcoming events yet"
            body="When your director adds real program events, they will show up here."
          />
        </Card>
      )}

      <section className="space-y-2">
        <SectionTitle action={<button className="text-xs font-bold text-band underline dark:text-emerald-300" onClick={() => navigate("/calendar")}>View calendar</button>}>
          Your Upcoming Events
        </SectionTitle>
        {upcoming.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} programName={app.program?.short_name || app.program?.name || "Program"} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Nothing scheduled"
              body="Only actual events from the database appear here."
            />
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <SectionTitle>{app.program?.short_name ?? "Program"} Attendance</SectionTitle>
        <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
          {percentage !== null && !app.isDirector ? (
            <Card className="flex items-center gap-4">
              <ProgressRing value={percentage} size={72} stroke={8} />
              <div className="min-w-0">
                <p className="font-semibold">Overall attendance</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Based on your recorded required events.
                </p>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<ClipboardCheck className="h-6 w-6" />}
                title="Attendance percentage unavailable"
                body="Your percentage appears once the system has records to calculate."
              />
            </Card>
          )}

          <Card className="overflow-hidden p-0">
            {attendanceRows.length > 0 ? (
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {attendanceRows.map((row) => (
                  <div key={row.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{row.name}</p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {relativeDay(row.date)} · {eventTypeLabel(row.event_type)}
                      </p>
                    </div>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {new Date(row.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                    <Badge className={ATTENDANCE_STATUS_CHIP[row.status]}>
                      {ATTENDANCE_STATUS_LABEL[row.status]}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ClipboardCheck className="h-6 w-6" />}
                title="No attendance history yet"
                body="Past required events with recorded attendance will appear here."
              />
            )}
          </Card>
        </div>
      </section>

      {app.isStaff ? (
        <section className="space-y-2">
          <SectionTitle>Staff Tools</SectionTitle>
          <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
            <Row
              icon={<ClipboardCheck className="h-5 w-5" />}
              title="Attendance"
              subtitle="Mark the roll, excuses and notes"
              onClick={() => navigate("/attendance")}
            />
            <Row
              icon={<Users className="h-5 w-5" />}
              title="Roster"
              subtitle={`${app.program?.short_name ?? "Program"} members and sections`}
              onClick={() => navigate("/roster")}
            />
            <Row
              icon={<QrCode className="h-5 w-5" />}
              title="Start a check-in"
              subtitle="Show the QR code and the 8-character code"
              onClick={() => navigate("/checkin")}
            />
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function ProgramCard({
  membership,
  current,
  onOpen,
}: {
  membership: EmbeddedMembership;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
        <Music className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-black">{membership.ensemble.short_name || membership.ensemble.name}</h3>
          <Badge className="bg-band text-white">Available</Badge>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Attendance & Events</p>
      </div>
      <Button size="sm" variant={current ? "accent" : "secondary"} icon={<ArrowRight className="h-4 w-4" />} onClick={onOpen}>
        {current ? "Open" : "Switch"}
      </Button>
    </Card>
  );
}

function FutureProgramCard({ name }: { name: string }) {
  return (
    <Card className="flex items-center gap-3 opacity-80">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
        <Music className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-black">{name}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Coming soon</p>
      </div>
      <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Coming soon</Badge>
    </Card>
  );
}

function EventCard({ event, programName }: { event: EventRow; programName: string }) {
  const required = ATTENDANCE_REQUIREMENT_LABEL[event.attendance_requirement];
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black">{event.name}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{programName}</p>
        </div>
        <Badge className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {eventTypeLabel(event.event_type)}
        </Badge>
      </div>
      <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
        <p>
          {relativeDay(event.date)} · {event.all_day ? "All day" : fmtTime(event.date)}
        </p>
        {event.location ? (
          <p className="flex items-center gap-1 truncate">
            <MapPin className="h-4 w-4 shrink-0 text-zinc-400" />
            {event.location}
          </p>
        ) : null}
      </div>
      <Badge className={event.attendance_requirement === "required" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}>
        Attendance: {required}
      </Badge>
    </Card>
  );
}

function HeroEventCard({
  event,
  isToday,
  alreadyCheckedIn,
  checkedInAt,
  isStaff,
  onCheckIn,
  onStartCheckIn,
  onMarkAttendance,
}: {
  event: EventRow;
  isToday: boolean;
  alreadyCheckedIn: boolean;
  checkedInAt: string | null;
  isStaff: boolean;
  onCheckIn: () => void;
  onStartCheckIn: () => void;
  onMarkAttendance: () => void;
}) {
  const isQr = event.checkin_mode === "qr" || event.checkin_mode === "both";
  const isToggle = event.checkin_mode === "toggle";
  const noAttendance = event.checkin_mode === "none";

  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-band px-4 py-3.5 text-white">
        <div className="flex items-center gap-2">
          <Badge className="bg-white/20 text-white">{eventTypeLabel(event.event_type)}</Badge>
          {isToday ? <Badge className="bg-accent text-ink">Today</Badge> : null}
        </div>
        <h2 className="mt-2 text-xl leading-tight font-extrabold">{event.name}</h2>
        <p className="mt-1 text-sm text-white/85">
          {relativeDay(event.date)} · {event.all_day ? "All day" : fmtTime(event.date)}
          {isToday ? ` · ${untilLabel(event.date)}` : ""}
        </p>
        {event.location ? <p className="mt-0.5 truncate text-sm text-white/70">{event.location}</p> : null}
      </div>

      <div className="space-y-2 p-4">
        {noAttendance ? (
          <Alert tone="info">No attendance is taken for this event.</Alert>
        ) : alreadyCheckedIn ? (
          <div className="flex items-center gap-2 rounded-xl bg-band/10 px-3 py-3 dark:bg-band/20">
            <CheckCircle2 className="h-5 w-5 text-band dark:text-emerald-300" />
            <p className="text-sm font-semibold">
              You&rsquo;re checked in{checkedInAt ? ` · ${fmtTime(checkedInAt)}` : ""}
            </p>
          </div>
        ) : isStaff ? (
          <Button
            block
            size="lg"
            icon={isQr ? <QrCode className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
            onClick={isQr ? onStartCheckIn : onMarkAttendance}
          >
            {isQr ? "Start check-in" : "Mark attendance"}
          </Button>
        ) : isQr ? (
          <Button block size="lg" icon={<QrCode className="h-5 w-5" />} onClick={onCheckIn}>
            Check in
          </Button>
        ) : isToggle ? (
          <Alert tone="info">Your section leader or director marks the roll for this one.</Alert>
        ) : null}

        {isQr && !alreadyCheckedIn ? (
          <p className={cn("text-center text-xs text-zinc-500 dark:text-zinc-400")}>
            {isStaff ? "Project the screen so students can scan it." : "Scan the QR code on screen, or type the 8-character code."}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
