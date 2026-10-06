import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CircleAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Card,
  EmptyState,
  ProgressRing,
  Row,
  SectionTitle,
  Sheet,
  Skeleton,
  cn,
} from "../components/ui";
import { fetchRoster } from "../lib/queries";
import {
  getAttendanceTrend,
  getEventAttendanceSummary,
  getSectionAttendanceStats,
  getStudentAttendancePct,
} from "../lib/rpc";
import type { RosterMember, RpcResult, SectionStatRow, TrendRow } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { eventTypeLabel } from "../lib/constants";
import { relativeDay } from "../lib/date";

/**
 * `/analytics` — the director's numbers.
 *
 * Every figure here comes from `attendance_pct_for()` or the RPCs built on it, so
 * a student's own ring and the director's table can never disagree. A refusal
 * (`{ ok: false }`) is shown as plain words, never as a zero.
 */

function toneFor(pct: number): { chip: string; label: string } {
  if (pct >= 80) {
    return { chip: "bg-band text-white", label: "Good standing" };
  }
  if (pct >= 60) {
    return {
      chip: "bg-accent text-ink",
      label: "Slipping",
    };
  }
  return {
    chip: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    label: "Needs attention",
  };
}

export function AnalyticsScreen() {
  const app = usePrograms();
  const programId = app.program?.id ?? null;

  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [pcts, setPcts] = useState<Map<string, number | null>>(new Map());
  const [sections, setSections] = useState<SectionStatRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [pick, setPick] = useState<TrendRow | null>(null);
  const [summary, setSummary] = useState<RpcResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    setError(null);
    try {
      const [people, sectionStats, recent] = await Promise.all([
        fetchRoster(programId),
        getSectionAttendanceStats(programId),
        getAttendanceTrend(programId, 10),
      ]);

      setRoster(people);
      setSections(sectionStats.rows);
      setTrend(recent.rows);
      setRefusal(sectionStats.message ?? recent.message ?? null);

      const rosterStudents = people.filter((m) => m.active && !m.roles.includes("director"));
      const pairs: Array<[string, number | null]> = [];
      // One call per student, in small batches — a hundred-piece marching band
      // must not open a hundred requests at once from a phone in a hallway.
      const BATCH = 8;
      for (let i = 0; i < rosterStudents.length; i += BATCH) {
        const batch = rosterStudents.slice(i, i + BATCH);
        const got = await Promise.all(
          batch.map(async (s) => {
            const { result } = await getStudentAttendancePct(s.user_id, programId);
            const pct =
              result?.ok && typeof result.percentage === "number" ? result.percentage : null;
            return [s.user_id, pct] as [string, number | null];
          })
        );
        pairs.push(...got);
      }
      setPcts(new Map(pairs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the numbers.");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const students = useMemo(
    () => (roster ?? []).filter((m) => m.active && !m.roles.includes("director")),
    [roster]
  );

  const ranked = useMemo(
    () =>
      students
        .map((s) => ({ member: s, pct: pcts.get(s.user_id) ?? null }))
        .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)),
    [students, pcts]
  );

  const overall = useMemo(() => {
    const known = ranked.map((r) => r.pct).filter((p): p is number => p !== null);
    if (known.length === 0) return null;
    return Math.round(known.reduce((sum, p) => sum + p, 0) / known.length);
  }, [ranked]);

  const struggling = useMemo(
    () => ranked.filter((r) => r.pct !== null && r.pct < 80).slice(0, 6),
    [ranked]
  );

  async function openEvent(row: TrendRow) {
    setPick(row);
    setSummary(null);
    setSummaryLoading(true);
    const { result } = await getEventAttendanceSummary(row.id);
    setSummary(result);
    setSummaryLoading(false);
  }

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (refusal && sections.length === 0 && trend.length === 0) {
    return (
      <div className="space-y-4 p-4 pb-6">
        <Card>
          <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Directors only" body={refusal} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {refusal && !(sections.length === 0 && trend.length === 0) ? (
        <Alert tone="warn">{refusal}</Alert>
      ) : null}

      {/* --- the one number that matters --- */}
      <Card className="flex items-center gap-4">
        {loading && overall === null && students.length > 0 ? (
          <Skeleton className="h-18 w-18 rounded-full" />
        ) : overall === null ? (
          <ProgressRing value={0} size={76} stroke={8}>
            <span className="text-sm font-bold text-zinc-400">—</span>
          </ProgressRing>
        ) : (
          <ProgressRing value={overall} size={76} stroke={8} />
        )}
        <div className="min-w-0">
          <p className="font-bold">Program attendance</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {students.length === 0
              ? "No students on the roster yet."
              : `${students.length} ${students.length === 1 ? "student" : "students"} · average across every required event`}
          </p>
          {overall !== null ? (
            <Badge className={cn("mt-1.5", toneFor(overall).chip)}>{toneFor(overall).label}</Badge>
          ) : null}
        </div>
      </Card>

      {students.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Nothing to measure yet"
            body="Once students are on the roster and events have happened, their percentages show up here."
          />
        </Card>
      ) : null}

      {/* --- who needs a nudge --- */}
      {struggling.length > 0 ? (
        <div className="space-y-1">
          <SectionTitle className="pt-1">Needs a nudge</SectionTitle>
          <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
            {struggling.map(({ member, pct }) => {
              const name = member.profile.display_name || member.profile.full_name;
              return (
                <Row
                  key={member.user_id}
                  icon={<CircleAlert className="h-5 w-5" />}
                  title={name}
                  subtitle={`${member.section_name || "No section"} · ${pct}% of required events`}
                  trailing={
                    <Badge className={toneFor(pct ?? 0).chip}>{pct}%</Badge>
                  }
                />
              );
            })}
          </Card>
        </div>
      ) : null}

      {/* --- by section --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">By section</SectionTitle>
        {loading && sections.length === 0 ? (
          <Skeleton className="h-40 w-full" />
        ) : sections.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No section averages yet"
              body="Put students into sections on the Roster screen and their averages land here."
            />
          </Card>
        ) : (
          <Card className="space-y-3">
            {sections.map((s) => (
              <div key={s.section} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate font-semibold">{s.section}</p>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {Math.round(s.avg_attendance_pct)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      s.avg_attendance_pct >= 80
                        ? "bg-band"
                        : s.avg_attendance_pct >= 60
                          ? "bg-accent"
                          : "bg-red-500"
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, s.avg_attendance_pct))}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {s.member_count} {s.member_count === 1 ? "student" : "students"}
                </p>
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* --- recent events --- */}
      <div className="space-y-1">
        <SectionTitle
          className="pt-1"
          action={
            <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <TrendingUp className="h-3.5 w-3.5" />
              last {trend.length}
            </span>
          }
        >
          Recent events
        </SectionTitle>
        {loading && trend.length === 0 ? (
          <Skeleton className="h-40 w-full" />
        ) : trend.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="No past events yet"
              body="Attendance trends appear after your first required event."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
            {trend.map((row) => {
              const rate = row.roster_size > 0 ? Math.round((row.present_count / row.roster_size) * 100) : 0;
              return (
                <Row
                  key={row.id}
                  icon={<CalendarDays className="h-5 w-5" />}
                  title={row.name}
                  subtitle={`${relativeDay(row.date)} · ${eventTypeLabel(
                    row.event_type
                  )} · ${row.present_count} of ${row.roster_size}${
                    row.excused_count > 0 ? ` · ${row.excused_count} excused` : ""
                  }`}
                  trailing={<Badge className={toneFor(rate).chip}>{rate}%</Badge>}
                  onClick={() => void openEvent(row)}
                />
              );
            })}
          </Card>
        )}
      </div>

      {/* --- the whole roster, worst first --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">Every student</SectionTitle>
        {roster === null ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
            {ranked.map(({ member, pct }) => {
              const name = member.profile.display_name || member.profile.full_name;
              return (
                <div key={member.user_id} className="flex min-h-14 items-center gap-3 px-2 py-2">
                  <Avatar name={name} url={member.profile.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name}</span>
                    <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {member.section_name || "No section"}
                    </span>
                  </span>
                  {pct === null ? (
                    <Badge className="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      Not enough yet
                    </Badge>
                  ) : (
                    <Badge className={toneFor(pct).chip}>{pct}%</Badge>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {/* --- one event, broken down --- */}
      <Sheet
        open={pick !== null}
        onClose={() => setPick(null)}
        title={pick?.name ?? "Event"}
        description={pick ? `${relativeDay(pick.date)} · ${eventTypeLabel(pick.event_type)}` : undefined}
      >
        {summaryLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !summary?.ok ? (
          <Alert tone="error">{summary?.message ?? "Could not load this event."}</Alert>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: "Present", value: summary.present ?? 0, chip: "text-band dark:text-emerald-300" },
                { label: "Late", value: summary.late ?? 0, chip: "text-amber-600 dark:text-amber-400" },
                { label: "Excused", value: summary.excused ?? 0, chip: "text-sky-600 dark:text-sky-400" },
                { label: "Absent", value: summary.absent ?? 0, chip: "text-red-600 dark:text-red-400" },
              ].map((cell) => (
                <div
                  key={cell.label}
                  className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.06]"
                >
                  <p className={cn("text-2xl font-extrabold tabular-nums", cell.chip)}>{cell.value}</p>
                  <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {cell.label}
                  </p>
                </div>
              ))}
            </div>

            {typeof summary.total === "number" && typeof summary.present === "number" ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  {summary.present} of {summary.total} on the roster attended
                  {summary.late ? ` (${summary.late} of them late)` : ""}.
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-band transition-all"
                    style={{
                      width: `${
                        summary.total > 0
                          ? Math.round(((summary.present ?? 0) / summary.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Students with no mark count as absent — staff can still fix a mark from the
              Attendance screen.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
