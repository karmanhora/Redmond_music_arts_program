import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, CheckCircle2, ClipboardCheck, Music, QrCode, Users } from "lucide-react";
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
import { getMyAttendancePct } from "../lib/rpc";
import type { EventRow } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { eventTypeLabel } from "../lib/constants";
import { endOfDay, fmtTime, isSameDay, relativeDay, startOfDay, untilLabel } from "../lib/date";

/**
 * The home screen answers one question — "do I need to check in right now?" —
 * and puts the answer in a single button. The month grid the old app opened on
 * now lives one tap away in the calendar.
 */
export function HomeScreen() {
  const app = usePrograms();
  const navigate = useNavigate();

  const programId = app.program?.id ?? null;
  const profileId = app.profile?.id ?? null;

  const [events, setEvents] = useState<EventRow[] | null>(null);
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

      // Did I already check in today? The answer changes the hero's button.
      const [todayAttendance, myPct] = await Promise.all([
        profileId
          ? fetchAttendance(programId, {
              from: startOfDay(new Date()).toISOString(),
              to: endOfDay(new Date()).toISOString(),
            })
          : Promise.resolve([]),
        getMyAttendancePct(programId),
      ]);

      const mine = todayAttendance.find((r) => r.student_id === profileId) ?? null;
      setCheckedInEventId(mine?.event_id ?? null);
      setCheckedInAt(mine?.checked_in_at ?? null);

      if (myPct.result?.ok && typeof myPct.result.percentage === "number") {
        setPercentage(myPct.result.percentage);
      } else {
        // Students see their own number, and a failure here must never look
        // like a data problem — just hide the card.
        setPercentage(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your schedule.");
    } finally {
      setLoading(false);
    }
  }, [programId, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A phone sitting in a pocket all day must show today's event when it wakes.
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

  const todayEvent = useMemo(
    () => events?.find((e) => isSameDay(new Date(e.date), new Date())) ?? null,
    [events]
  );

  const nextEvent = useMemo(
    () =>
      events?.find(
        (e) => new Date(e.date).getTime() >= now && !isSameDay(new Date(e.date), new Date())
      ) ?? null,
    [events, now]
  );

  const hero = todayEvent ?? nextEvent;
  const upcoming = useMemo(
    () =>
      (events ?? [])
        .filter((e) => new Date(e.date).getTime() > now && e.id !== hero?.id)
        .slice(0, 5),
    [events, hero?.id, now]
  );

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && !events ? (
        <>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </>
      ) : hero ? (
        <HeroCard
          event={hero}
          isToday={hero.id === todayEvent?.id}
          alreadyCheckedIn={checkedInEventId === hero.id}
          checkedInAt={checkedInAt}
          onCheckIn={() => navigate("/checkin")}
          onStartCheckIn={() => navigate(`/checkin?event=${hero.id}`)}
          onMarkAttendance={() => navigate("/attendance")}
          isStaff={app.isStaff}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<Music className="h-6 w-6" />}
            title="Nothing on the calendar yet"
            body="When your director adds rehearsals and games, the next one shows up right here."
          />
        </Card>
      )}

      {percentage !== null && !app.isDirector ? (
        <Card className="flex items-center gap-4">
          <ProgressRing value={percentage} size={72} stroke={8} />
          <div className="min-w-0">
            <p className="font-semibold">My attendance</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {percentage >= 80
                ? "You're in good standing. Keep it up."
                : "Every rehearsal counts — you've got this."}
            </p>
          </div>
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="space-y-1">
          <SectionTitle className="pt-1">Coming up</SectionTitle>
          <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
            {upcoming.map((e) => (
              <Row
                key={e.id}
                icon={<CalendarDays className="h-5 w-5" />}
                title={e.name}
                subtitle={`${relativeDay(e.date)} · ${
                  e.all_day ? "All day" : fmtTime(e.date)
                } · ${eventTypeLabel(e.event_type)}`}
                onClick={() => navigate("/calendar")}
              />
            ))}
          </Card>
        </div>
      ) : null}

      {app.isStaff ? (
        <div className="space-y-1">
          <SectionTitle className="pt-1">Staff</SectionTitle>
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
        </div>
      ) : null}
    </div>
  );
}

function HeroCard({
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
        <h1 className="mt-2 text-xl leading-tight font-extrabold">{event.name}</h1>
        <p className="mt-1 text-sm text-white/85">
          {relativeDay(event.date)} · {event.all_day ? "All day" : fmtTime(event.date)}
          {isToday ? ` · ${untilLabel(event.date)}` : ""}
        </p>
        {event.location ? (
          <p className="mt-0.5 truncate text-sm text-white/70">{event.location}</p>
        ) : null}
      </div>

      <div className="space-y-2 p-4">
        {noAttendance ? (
          <Alert tone="info">No attendance is taken for this event — nothing to do.</Alert>
        ) : alreadyCheckedIn ? (
          <div className="flex items-center gap-2 rounded-xl bg-band/10 px-3 py-3 dark:bg-band/20">
            <CheckCircle2 className="h-5 w-5 text-band dark:text-emerald-300" />
            <p className="text-sm font-semibold">
              You&rsquo;re checked in
              {checkedInAt ? ` — ${fmtTime(checkedInAt)}` : ""}
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
          <Alert tone="info">
            Your section leader or director marks the roll for this one — nothing to scan.
          </Alert>
        ) : null}

        {isQr && !alreadyCheckedIn ? (
          <p className={cn("text-center text-xs text-zinc-500 dark:text-zinc-400")}>
            {isStaff
              ? "Project the screen so everyone can scan it."
              : "Scan the QR code on screen, or type the 8-character code."}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
