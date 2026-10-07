import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, RefreshCw, Timer, Users, X } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressRing,
  SectionTitle,
  Spinner,
  cn,
} from "./ui";
import { fetchAttendance, fetchRoster, fetchSessionForEvent } from "../lib/queries";
import { startCheckinSession } from "../lib/rpc";
import type { AttendanceRow, EventRow, RosterMember, RpcResult } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { eventTypeLabel } from "../lib/constants";
import { endOfDay, fmtTime, mmss, relativeDay, startOfDay } from "../lib/date";

/** Sessions live for five minutes (see `start_checkin_session`). */
const SESSION_MS = 5 * 60 * 1000;
const POLL_MS = 5000;

/**
 * The projector view: a wall-mounted code plus a live count of who is still
 * missing. Legible from the back of the band hall, and it never keeps showing a
 * code that has expired.
 */
export function LiveCheckIn({ event, onExit }: { event: EventRow; onExit: () => void }) {
  const app = usePrograms();
  const programId = app.program?.id ?? null;

  const [session, setSession] = useState<RpcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);

  const canRunCode = event.checkin_mode === "qr" || event.checkin_mode === "both";

  const refreshLive = useCallback(async () => {
    if (!programId) return;
    try {
      const [att, people] = await Promise.all([
        fetchAttendance(programId, {
          from: startOfDay(event.date).toISOString(),
          to: endOfDay(event.date).toISOString(),
        }),
        fetchRoster(programId),
      ]);
      setAttendance(att.filter((a) => a.event_id === event.id));
      setRoster(people);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh the live roster.");
    }
  }, [programId, event.id, event.date]);

  // Adopt a session that is already running (e.g. the projector page reloaded).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await fetchSessionForEvent(event.id);
        if (cancelled || !existing) return;
        if (new Date(existing.expires_at).getTime() > Date.now()) {
          setSession({
            ok: true,
            token: existing.token,
            entry_code: existing.entry_code,
            expires_at: existing.expires_at,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not check for an active session.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  useEffect(() => {
    void refreshLive();
    const id = window.setInterval(() => void refreshLive(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshLive]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { result, error: rpcError } = await startCheckinSession(event.id);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      if (!result?.ok) {
        setError(result?.message ?? "Could not start a check-in.");
        return;
      }
      setSession(result);
      void refreshLive();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a check-in.");
    } finally {
      setBusy(false);
    }
  }, [event.id, refreshLive]);

  const expiresMs = session?.expires_at ? new Date(session.expires_at).getTime() : null;
  const remainingMs = expiresMs ? Math.max(0, expiresMs - nowMs) : 0;
  const expired = expiresMs !== null && remainingMs <= 0;
  const ringPct = expiresMs ? (remainingMs / SESSION_MS) * 100 : 0;
  const expiringSoon = remainingMs > 0 && remainingMs <= 60_000;

  const students = useMemo(
    () => roster.filter((m) => m.active && !m.roles.includes("director")),
    [roster]
  );

  const checkedIn = useMemo(
    () => attendance.filter((a) => a.attended && a.status !== "excused"),
    [attendance]
  );

  const missingBySection = useMemo(() => {
    const done = new Set(checkedIn.map((a) => a.student_id));
    const groups = new Map<string, RosterMember[]>();
    for (const member of students) {
      if (done.has(member.user_id)) continue;
      const key = member.section_name || "No section";
      const list = groups.get(key) ?? [];
      list.push(member);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [checkedIn, students]);

  const recent = useMemo(
    () =>
      [...checkedIn]
        .filter((a) => a.checked_in_at)
        .sort(
          (a, b) =>
            new Date(b.checked_in_at as string).getTime() -
            new Date(a.checked_in_at as string).getTime()
        )
        .slice(0, 6),
    [checkedIn]
  );

  const nameOf = useCallback(
    (userId: string) => {
      const member = roster.find((m) => m.user_id === userId);
      return member ? member.profile.display_name || member.profile.full_name : "Someone";
    },
    [roster]
  );

  const pctCheckedIn = students.length
    ? Math.round((checkedIn.length / students.length) * 100)
    : 0;

  const missingCount = students.length - checkedIn.length;
  const waitingForFirstScan = attendance.length === 0 && checkedIn.length === 0;

  const checkinUrl = session?.token
    ? `${window.location.origin}/checkin?token=${session.token}`
    : null;

  return (
    <div className="space-y-4">
      {/* --- header --- */}
      <Card className="flex items-start gap-3 border-l-4 border-l-[var(--cue-gold)]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-band text-white">{eventTypeLabel(event.event_type)}</Badge>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {relativeDay(event.date)} · {event.all_day ? "All day" : fmtTime(event.date)}
            </span>
          </div>
          <p className="mt-1 font-display text-3xl font-bold uppercase">
            <span className="cue-line">
              <span className="cue-line-inner truncate">{event.name}</span>
            </span>
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onExit}
          icon={<X className="h-4 w-4" />}
        >
          Stop
        </Button>
      </Card>

      {error ? <Alert tone="warn">{error}</Alert> : null}

      {!canRunCode ? (
        <Alert tone="info">
          This event uses {event.checkin_mode === "none" ? "no check-in" : "staff marking the roll"}
          {" — "}mark it from the Attendance screen instead.
        </Alert>
      ) : !session || session.ok !== true || !checkinUrl ? (
        <Card className="animate-in flex flex-col items-center gap-3 border-t-4 border-t-[var(--cue-green)] py-8 text-center">
          <Timer className="h-8 w-8 text-[var(--cue-green)]" />
          <div>
            <p className="font-display text-2xl font-bold uppercase">Ready when you are</p>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              The code is good for 5 minutes. Refresh it whenever you need to.
            </p>
          </div>
          <Button size="lg" loading={busy} onClick={() => void start()}>
            Start check-in
          </Button>
        </Card>
      ) : (
        <div className="cue-stagger grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
          {/* --- the code itself --- */}
          {/* Keyed to the session: a refreshed code lands as a fresh arrival
              instead of silently swapping pixels. */}
          <Card
            key={session.token}
            className="flex flex-col items-center gap-4 border-t-4 border-t-[var(--cue-green)] py-5 sm:py-6"
          >
            <div
              className={cn(
                "rounded-[var(--radius-control)] bg-white p-3 ring-1 ring-black/15 transition-opacity",
                expired && "opacity-25"
              )}
            >
              <QRCodeSVG value={checkinUrl} size={240} level="M" fgColor="#173b28" bgColor="#ffffff" />
            </div>

            <div className="text-center">
              <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
                Or type this code
              </p>
              <p
                className={cn(
                  "mt-1 font-mono text-[40px] leading-none font-extrabold tracking-[0.3em] sm:text-6xl",
                  expired && "text-zinc-400 line-through"
                )}
              >
                {session.entry_code}
              </p>
            </div>

            {expired ? (
              <div className="flex flex-col items-center gap-2">
                <Alert tone="warn">Code expired — get a fresh one.</Alert>
                <Button loading={busy} onClick={() => void start()} icon={<RefreshCw className="h-4 w-4" />}>
                  New code
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ProgressRing value={ringPct} size={64} stroke={7}>
                  <span className="font-mono text-xs font-bold">{mmss(session.expires_at!, nowMs)}</span>
                </ProgressRing>
                <div className="text-left">
                  <p className={cn("text-sm font-semibold", expiringSoon && "text-[var(--cue-late)]")}>
                    {expiringSoon ? "Refresh soon" : "Live for"} {mmss(session.expires_at!, nowMs)}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {checkedIn.length} of {students.length} checked in
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 -ml-3"
                    loading={busy}
                    onClick={() => void start()}
                    icon={<RefreshCw className="h-4 w-4" />}
                  >
                    New code
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="space-y-3 border-l-4 border-l-[var(--cue-green)]">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-extrabold tabular-nums">
                  <span key={checkedIn.length} className="cue-odometer">
                    {checkedIn.length}
                  </span>
                  <span className="text-lg text-zinc-400"> / {students.length}</span>
                </p>
                <p className="font-display text-lg font-bold tracking-wide uppercase">checked in</p>
              </div>
              <span
                key={waitingForFirstScan ? "waiting" : "live"}
                className="animate-in flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
              >
                {waitingForFirstScan ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" /> waiting for the first scan
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="cue-live-breathe h-4 w-4 text-band dark:text-emerald-300" /> live
                  </>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="cue-meter-fill h-full w-full rounded-full bg-[var(--cue-green)]"
                style={{ transform: `scaleX(${pctCheckedIn / 100})` }}
              />
            </div>
            <p className="text-sm font-semibold tabular-nums text-[var(--cue-muted)]">
              {checkedIn.length} of {students.length} musicians · {pctCheckedIn}%
            </p>
          </Card>

          {recent.length > 0 ? (
            <Card className="animate-in space-y-2">
              <SectionTitle>Just checked in</SectionTitle>
              <ul className="space-y-1">
                {recent.map((a) => (
                  <li key={a.id} className="roster-arrive flex min-h-11 items-center justify-between gap-3 border-b border-[var(--cue-border)] py-2 text-sm last:border-0">
                    <span className="truncate font-medium">{nameOf(a.student_id)}</span>
                    <span className="shrink-0 text-[var(--cue-muted)]">
                      {a.checked_in_at ? fmtTime(a.checked_in_at) : ""}
                      {a.is_late ? " · late" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="space-y-3">
            <SectionTitle
              action={
                <span className="flex items-center gap-1.5 text-xs text-[var(--cue-muted)]">
                  <Users className="h-4 w-4" />
                  <span>
                    <span key={missingCount} className="cue-odometer">{missingCount}</span> missing
                  </span>
                </span>
              }
            >
              Still missing
            </SectionTitle>
            {missingBySection.length === 0 ? (
              <p className="animate-in py-4 text-center text-sm font-semibold text-band dark:text-emerald-300">
                Everyone&rsquo;s here. Nice.
              </p>
            ) : (
              <div className="space-y-2">
                {missingBySection.map(([section, members]) => (
                  <div
                    key={section}
                    className="rounded-[var(--radius-control)] border border-[var(--cue-border)] p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-bold">{section}</p>
                      <span className="text-xs font-bold text-[var(--cue-muted)]">
                        {members.length}
                      </span>
                    </div>
                    <ul className="mt-2 grid gap-x-3 sm:grid-cols-2">
                      {members.map((member) => (
                        <li
                          key={member.user_id}
                          className="min-w-0 break-words border-t border-[var(--cue-border)]/70 py-1.5 text-sm"
                        >
                          {member.profile.display_name || member.profile.full_name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </div>
        </div>
      )}

      {students.length === 0 && roster.length > 0 ? (
        <EmptyState
          title="No students on the roster yet"
          body="Add members from the Roster screen and they'll show up here."
        />
      ) : null}
    </div>
  );
}
