import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, KeyRound, LogOut, Music, ShieldCheck, Users } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Row,
  SectionTitle,
  Skeleton,
  useToast,
} from "../components/ui";
import { joinProgram, listActivePrograms } from "../lib/rpc";
import type { ProgramOption } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { useAuth } from "../hooks/useAuth";
import { APP_NAME, ORG_NAME } from "../lib/constants";

/**
 * Joining a program — the first one and every one after it.
 *
 * There is deliberately ONE implementation of this flow, used twice:
 *
 *   * standalone (no app bar, no bottom nav) when somebody is signed in but on
 *     no roster at all, and
 *   * as the `/join` route inside the shell, reached from the program switcher,
 *     from Profile, and from the roster screen's empty state.
 *
 * The code is checked by `join_program()` on the server — rate-limited; this
 * screen only collects it. When the person has no profile yet that same call
 * creates one, which is why their name is asked for here rather than guessed
 * from the account.
 *
 * Joining somebody else's program is not the only way in: a teacher with nobody
 * to ask can start their own from here (`/new-program`). That option is shown
 * only to teacher accounts and is independently checked by the server.
 */
export function JoinProgramScreen({ standalone = false }: { standalone?: boolean }) {
  const app = usePrograms();
  const auth = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [programs, setPrograms] = useState<ProgramOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  /** No profile yet? This call creates it, so it needs a name to store. */
  const needsName = !app.profile;

  const load = useCallback(async () => {
    const { rows, error: rpcError, message } = await listActivePrograms();
    if (rpcError) setListError(rpcError.message);
    else if (message) setListError(message);
    setPrograms(rows);
    // One program on the whole site? Choose it for them.
    if (rows.length === 1) setSelected(rows[0]!.slug);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chosen = useMemo(
    () => (programs ?? []).find((p) => p.slug === selected) ?? null,
    [programs, selected]
  );
  const needsCode = chosen?.has_join_code !== false;

  const canSubmit =
    Boolean(chosen) &&
    (!needsCode || code.trim().length > 0) &&
    (!needsName || name.trim().length > 0);

  async function submit() {
    if (!chosen) {
      setError("Pick a program first.");
      return;
    }
    if (needsCode && !code.trim()) {
      setError("Type the join code your director gave you.");
      return;
    }
    if (needsName && !name.trim()) {
      setError("Type your name so your director knows who joined.");
      return;
    }

    setBusy(true);
    setError(null);
    const { result, error: rpcError } = await joinProgram(chosen.slug, code.trim(), name.trim());

    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    if (!result?.ok) {
      setBusy(false);
      setError(result?.message ?? "That join code didn't work.");
      return;
    }

    // Landed: re-read the session so the whole app re-themes to that program —
    // and land in *that* one, so joining a second program actually switches to it.
    await app.refresh(result.program_id ?? undefined);
    setBusy(false);
    toast.success(result.message ?? `You're in ${chosen.name}.`);
    if (!standalone) navigate("/");
  }

  const form = (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {auth.accountTypeSetupError ? (
        <Alert tone="error">
          We couldn&rsquo;t save your student or teacher account choice. Sign out and try again.{" "}
          {auth.accountTypeSetupError}
        </Alert>
      ) : null}

      <Card className="space-y-2">
        <p className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-5 w-5 text-band dark:text-emerald-300" />
          Join a program
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your director gives you a join code. It puts you on that program&rsquo;s roster — its
          rehearsals, its calendar and your own attendance.
        </p>
      </Card>

      {/* Point teacher accounts at the way in that needs nobody's permission. */}
      {standalone && auth.accountType === "teacher" ? (
        <Card className="flex items-start gap-2 border-l-4 border-l-[var(--cue-gold)]">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cue-gold)]" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-[var(--cue-ink)]">Teaching here?</span>{" "}
            You don&rsquo;t need anybody&rsquo;s permission — start your own program and you&rsquo;re
            its director immediately, with the roster, attendance and live check-in tools ready to
            use. Use the code below only if you&rsquo;re joining a program somebody else already
            runs, which puts you on it as a student.
          </p>
        </Card>
      ) : null}

      {listError ? <Alert tone="warn">{listError}</Alert> : null}

      {programs === null ? (
        <Skeleton className="h-40 w-full" />
      ) : programs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Music className="h-6 w-6" />}
            title="No programs yet"
            body={
              app.canCreateProgram
                ? "Nobody has started one yet — you can be the first."
                : "No programs are available yet. Ask a teacher or director to get one started."
            }
          />
        </Card>
      ) : (
        <>
          <div className="space-y-1">
            <SectionTitle className="pt-1">Which program?</SectionTitle>
            <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
              {programs.map((p) => (
                <Row
                  key={p.slug}
                  icon={<Music className="h-5 w-5" />}
                  title={p.name}
                  subtitle={p.has_join_code ? "Needs a join code" : "No code needed"}
                  trailing={
                    selected === p.slug ? (
                      <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                    )
                  }
                  onClick={() => {
                    setSelected(p.slug);
                    setError(null);
                  }}
                />
              ))}
            </Card>
          </div>

          {needsName ? (
            <Field label="Your name" hint="Your director sees this on the roster.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                autoComplete="name"
              />
            </Field>
          ) : null}

          {needsCode ? (
            <Field
              label="Join code"
              hint="Ask your director — it is the same for everyone in that program."
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}
                placeholder="ABCD2345"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="text-center font-mono text-xl tracking-[0.25em]"
              />
            </Field>
          ) : null}

          <Button block size="lg" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            Join
          </Button>

          {!standalone ? (
            <Button block variant="ghost" onClick={() => navigate(-1)}>
              Not now
            </Button>
          ) : null}
        </>
      )}

      {app.canCreateProgram ? (
        <Card className="space-y-3">
          <div className="flex items-start gap-2">
            <Music className="mt-0.5 h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
            <div className="min-w-0">
              <p className="font-semibold">Running a program of your own?</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Name it and you&rsquo;re its director — the roster, attendance and live check-in
                tools come with it, and it starts closed with a join code for you to hand out.
              </p>
            </div>
          </div>
          <Button block variant="secondary" onClick={() => navigate("/new-program")}>
            Start a new program
          </Button>
        </Card>
      ) : null}

      <Card className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The code is checked on the server, never in this browser. If a director removed you from a
          program, only a director can put you back.
        </p>
      </Card>

      {standalone ? (
        <Button
          block
          variant="secondary"
          icon={<LogOut className="h-4 w-4" />}
          onClick={() => void auth.signOut()}
        >
          Sign out
        </Button>
      ) : null}
    </div>
  );

  if (!standalone) return form;

  return (
    <div className="safe-t flex min-h-full flex-col bg-surface dark:bg-[#0c0f0a]">
      <div className="bg-band px-6 pt-8 pb-6 text-white">
        <img src="/logo.svg" alt="" className="h-10 w-10" />
        <p className="mt-3 text-[11px] font-bold tracking-widest text-white/70 uppercase">
          {ORG_NAME}
        </p>
        <h1 className="mt-1 text-xl font-extrabold">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-white/80">
          You&rsquo;re signed in — join your program to see its calendar, its rehearsals and your own
          attendance.
        </p>
      </div>

      <div className="flex-1">{form}</div>

      {auth.email ? (
        <p className="px-6 pb-6 text-center text-xs text-zinc-400">Signed in as {auth.email}</p>
      ) : null}
    </div>
  );
}
