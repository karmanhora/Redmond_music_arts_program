import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  QrCode,
  ScanLine,
  Timer,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SegmentedControl,
  Sheet,
  Skeleton,
} from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { LiveCheckIn } from "../components/LiveCheckIn";
import { fetchEvents, fetchSessionForEvent } from "../lib/queries";
import { recordAttendance, recordAttendanceByCode } from "../lib/rpc";
import type { RpcResponse } from "../lib/rpc";
import type { EventRow, RpcResult } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { CHECKIN_CODE_LENGTH, CHECKIN_MODE_LABEL, eventTypeLabel } from "../lib/constants";
import { fmtTime, parseTokenFromString, relativeDay } from "../lib/date";

/**
 * `/checkin` — one route, two jobs.
 *
 *  * a `?token=…` deep link (or an unknown-code failure in the bucket) is
 *    accepted even when the bucket appears in the logs once;
 *  * students scan the projected QR code or type the 8 characters;
 *  * staff get the projector view (see LiveCheckIn) and can still check
 *    themselves in with the code, exactly like a student.
 */

/** A token is submitted once per page load; refresh shows the same outcome. */
const submittedTokens = new Set<string>();
const tokenOutcomes = new Map<string, RpcResult>();

export function CheckInScreen() {
  const app = usePrograms();
  const [params] = useSearchParams();
  const token = params.get("token");
  const eventParam = params.get("event");

  // A scanned code always wins — staff scan the wall too.
  if (token) return <StudentCheckIn token={token} />;
  if (app.isStaff) return <StaffCheckIn initialEventId={eventParam} />;
  return <StudentCheckIn token={null} />;
}

/* -------------------------------------------------------------------------- */
/* Student flow                                                               */
/* -------------------------------------------------------------------------- */

function StudentCheckIn({ token }: { token: string | null }) {
  return (
    <div className="space-y-4 p-4 pb-6">
      {token ? <TokenResult token={token} /> : <CheckInForm />}
    </div>
  );
}

/** Submits a token from the URL exactly once and renders the outcome. */
function TokenResult({ token }: { token: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "done">(() =>
    tokenOutcomes.has(token) || submittedTokens.has(token) ? "done" : "working"
  );
  const [outcome, setOutcome] = useState<RpcResult | null>(
    () => tokenOutcomes.get(token) ?? null
  );
  const [failure, setFailure] = useState<string | null>(null);

  // The first mount owns the request and always applies its result, even if
  // React re-invokes the effect (StrictMode) — otherwise the second invocation
  // would see the token already submitted and nobody would ever answer.
  useEffect(() => {
    if (submittedTokens.has(token)) {
      const cached = tokenOutcomes.get(token);
      if (cached) setOutcome(cached);
      return;
    }
    submittedTokens.add(token);
    void (async () => {
      const { result, error } = await recordAttendance(token);
      if (error) {
        setFailure(error.message);
      } else {
        if (result) tokenOutcomes.set(token, result);
        setOutcome(result);
        if (!result?.ok) setFailure(result?.message ?? "That code didn't work.");
      }
      setState("done");
    })();
  }, [token]);

  if (state === "working") {
    return (
      <Card className="flex flex-col items-center gap-3 py-10">
        <Skeleton className="h-12 w-12 rounded-full" />
        <p className="font-semibold">Checking you in…</p>
        <p className="text-sm text-zinc-500">Hold on a second.</p>
      </Card>
    );
  }

  if (outcome?.ok) {
    return (
      <div className="space-y-3">
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-band/12 dark:bg-band/25">
            <CheckCircle2 className="h-9 w-9 text-band dark:text-emerald-300" />
          </span>
          <p className="text-xl font-extrabold">
            {outcome.is_late ? "Checked in (late)" : "You're checked in"}
          </p>
          {outcome.event_name ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {outcome.event_name}
              {outcome.checked_in_at ? ` · ${fmtTime(outcome.checked_in_at)}` : ""}
            </p>
          ) : null}
          {outcome.message ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{outcome.message}</p>
          ) : null}
        </Card>
        <Button block variant="secondary" onClick={() => navigate("/")}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Alert tone="error">
        {failure ?? outcome?.message ?? "That check-in code didn't work."}
      </Alert>
      <Card className="space-y-2">
        <p className="font-semibold">Try another way</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          If the code on screen has changed, ask your director or section leader for the
          current one.
        </p>
      </Card>
      <CheckInForm />
    </div>
  );
}

/** Scan-or-type check-in. Shared by students and by staff checking themselves in. */
function CheckInForm() {
  const navigate = useNavigate();
  const app = usePrograms();
  const [tab, setTab] = useState<"scan" | "code">("scan");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RpcResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = useCallback(async (run: () => Promise<RpcResponse>) => {
    setBusy(true);
    setFailure(null);
    const { result, error } = await run();
    setBusy(false);
    if (error) {
      setFailure(error.message);
      return;
    }
    setOutcome(result);
    if (!result?.ok) setFailure(result?.message ?? "That didn't work — ask for a fresh code.");
  }, []);

  const onDecode = useCallback(
    (text: string) => {
      const parsed = parseTokenFromString(text);
      if (!parsed) {
        setFailure("That QR code isn't a check-in code for this program.");
        return;
      }
      void submit(() => recordAttendance(parsed));
    },
    [submit]
  );

  const onScannerError = useCallback((message: string) => setFailure(message), []);

  if (outcome?.ok) {
    return (
      <div className="space-y-3">
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-band/12 dark:bg-band/25">
            <CheckCircle2 className="h-9 w-9 text-band dark:text-emerald-300" />
          </span>
          <p className="text-xl font-extrabold">
            {outcome.is_late ? "Checked in (late)" : "You're checked in"}
          </p>
          {outcome.event_name ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {outcome.event_name}
              {outcome.checked_in_at ? ` · ${fmtTime(outcome.checked_in_at)}` : ""}
            </p>
          ) : null}
          {outcome.is_late ? (
            <Badge className="bg-accent text-ink">Late</Badge>
          ) : null}
        </Card>
        <Button block variant="secondary" onClick={() => navigate("/")}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-band dark:text-emerald-300" />
          <p className="font-semibold">Check in</p>
        </div>

        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "scan", label: "Scan QR" },
            { value: "code", label: "Enter code" },
          ]}
        />

        {tab === "scan" ? (
          <div className="space-y-2">
            <QrScanner active={!busy} onDecode={onDecode} onError={onScannerError} />
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              Point your camera at the QR code on the screen.
            </p>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().length < CHECKIN_CODE_LENGTH) return;
              void submit(() => recordAttendanceByCode(code.trim()));
            }}
          >
            <Field label="Check-in code" hint={`${CHECKIN_CODE_LENGTH} characters, on the screen`}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, CHECKIN_CODE_LENGTH))}
                placeholder="ABCD2345"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="text-center font-mono text-2xl tracking-[0.3em]"
                autoFocus
              />
            </Field>
            <Button
              block
              size="lg"
              type="submit"
              loading={busy}
              disabled={code.trim().length < CHECKIN_CODE_LENGTH}
              icon={<ScanLine className="h-5 w-5" />}
            >
              Check in
            </Button>
          </form>
        )}
      </Card>

      {failure ? <Alert tone="error">{failure}</Alert> : null}

      <TodayHint programId={app.program?.id ?? null} />
    </div>
  );
}

/** Small context card: is there something to check in for right now? */
function TodayHint({ programId }: { programId: string | null }) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!programId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await fetchEvents(programId, {
        from: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
        to: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
      });
      const session = list[0] ? await fetchSessionForEvent(list[0].id) : null;
      if (cancelled) return;
      setEvent(list[0] ?? null);
      setHasSession(Boolean(session && new Date(session.expires_at) > new Date()));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  if (loading) return <Skeleton className="h-16 w-full" />;
  if (!event) {
    return (
      <Card className="text-sm text-zinc-500 dark:text-zinc-400">
        Nothing on today&rsquo;s calendar. Check the calendar for what&rsquo;s next.
      </Card>
    );
  }

  return (
    <Card className="space-y-1">
      <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Today</p>
      <p className="font-semibold">{event.name}</p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {relativeDay(event.date)} · {event.all_day ? "All day" : fmtTime(event.date)} ·{" "}
        {eventTypeLabel(event.event_type)}
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {hasSession ? (
          <span className="flex items-center gap-1.5 font-medium text-band dark:text-emerald-300">
            <Timer className="h-4 w-4" /> A code is live right now
          </span>
        ) : (
          "No live code yet — ask your director or section leader."
        )}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff flow                                                                 */
/* -------------------------------------------------------------------------- */

function StaffCheckIn({ initialEventId }: { initialEventId: string | null }) {
  const app = usePrograms();
  const programId = app.program?.id ?? null;

  const [mode, setMode] = useState<"run" | "self">("run");
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialEventId);
  const [pickerOpen, setPickerOpen] = useState(false);
  // "Stop" must actually stop: without this the default-selection effect would
  // immediately reopen the live view it just closed.
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!programId) return;
    let cancelled = false;
    void (async () => {
      const list = await fetchEvents(programId);
      if (cancelled) return;
      setEvents(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  /** Events that can host a QR/code session, closest to now first. */
  const selectable = useMemo(() => {
    const list = (events ?? []).filter(
      (e) => e.checkin_mode === "qr" || e.checkin_mode === "both"
    );
    const now = Date.now();
    return [...list].sort(
      (a, b) => Math.abs(new Date(a.date).getTime() - now) - Math.abs(new Date(b.date).getTime() - now)
    );
  }, [events]);

  const selected = useMemo(
    () => selectable.find((e) => e.id === selectedId) ?? null,
    [selectable, selectedId]
  );

  // Pick a sensible default once the list arrives: today's session-friendly
  // event, else the nearest one.
  useEffect(() => {
    if (stopped || selectedId || selectable.length === 0) return;
    const today = selectable.find(
      (e) => new Date(e.date).toDateString() === new Date().toDateString()
    );
    setSelectedId((today ?? selectable[0]!).id);
  }, [selectable, selectedId, stopped]);

  if (mode === "self") {
    return (
      <div className="space-y-4 p-4 pb-6">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "run", label: "Run a check-in" },
            { value: "self", label: "Check in myself" },
          ]}
        />
        <CheckInForm />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      <SegmentedControl
        value={mode}
        onChange={setMode}
        options={[
          { value: "run", label: "Run a check-in" },
          { value: "self", label: "Check in myself" },
        ]}
      />

      {events === null ? (
        <Skeleton className="h-40 w-full" />
      ) : selectable.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="No event takes a check-in code"
            body="Add an event with QR or both check-in, or mark the roll from the Attendance screen."
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
              <QrCode className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {selected?.name ?? "Choose an event"}
              </span>
              <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                {selected
                  ? `${relativeDay(selected.date)} · ${
                      selected.all_day ? "All day" : fmtTime(selected.date)
                    } · ${CHECKIN_MODE_LABEL[selected.checkin_mode]}`
                  : "Tap to pick which event you're running"}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
          </button>

          {selected ? (
            <LiveCheckIn
              event={selected}
              onExit={() => {
                setStopped(true);
                setSelectedId(null);
              }}
            />
          ) : (
            <EmptyState
              icon={<QrCode className="h-6 w-6" />}
              title="Pick an event"
              body="Choose the rehearsal or game you're taking attendance for."
            />
          )}

          <Sheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title="Which event?"
            size="tall"
          >
            <ul className="space-y-1">
              {selectable.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setStopped(false);
                      setSelectedId(e.id);
                      setPickerOpen(false);
                    }}
                    className="flex min-h-14 w-full items-center gap-2 rounded-xl px-2 py-3 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{e.name}</span>
                      <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {relativeDay(e.date)} ·{" "}
                        {e.all_day ? "All day" : fmtTime(e.date)} ·{" "}
                        {eventTypeLabel(e.event_type)}
                      </span>
                    </span>
                    {e.id === selectedId ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        </>
      )}
    </div>
  );
}
