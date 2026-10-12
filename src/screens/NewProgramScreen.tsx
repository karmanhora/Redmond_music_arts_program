import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Alert, Button, Card, Field, Input, PageHeader, useToast } from "../components/ui";
import { InstrumentPicker } from "../components/InstrumentPicker";
import { createProgram } from "../lib/rpc";
import { usePrograms } from "../hooks/usePrograms";
import { useAuth } from "../hooks/useAuth";
import { APP_NAME, ORG_NAME } from "../lib/constants";

/**
 * Starting your own program — the teacher-only way to create a new roster.
 *
 * Joining somebody else's program needs their join code, so the first teacher in
 * a subject had nobody to ask and no way to use the app at all. This is the door
 * that does not need anybody: name a program, and `create_program()` makes the
 * caller its director. The roster, attendance and live check-in tools are ready
 * the moment it exists, and it starts **closed** — with its own join code for the
 * director to hand out.
 *
 * Like the join screen, this is used twice: standalone (no app bar, no bottom
 * nav) when somebody is signed in with no roster at all, and as the
 * `/new-program` route inside the shell, reached from the join screen, Profile
 * and the program switcher.
 *
 * The name is all this screen collects that the database does not already know.
 * There is deliberately nothing here to pick *which* program — the RPC can only
 * ever create a new one, which is what keeps "start a program" from becoming a
 * way to promote yourself into an existing roster.
 */
export function NewProgramScreen({ standalone = false }: { standalone?: boolean }) {
  const app = usePrograms();
  const auth = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [yourName, setYourName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** No profile yet? This call creates it, so it needs a name to store. */
  const needsName = !app.profile;
  const canSubmit = name.trim().length >= 2 && (!needsName || yourName.trim().length > 0);

  async function submit() {
    if (name.trim().length < 2) {
      setError("Give your program a name — at least two letters.");
      return;
    }
    if (needsName && !yourName.trim()) {
      setError("Type your name so your students know who runs the program.");
      return;
    }

    setBusy(true);
    setError(null);
    const { result, error: rpcError } = await createProgram(name, {
      shortName,
      displayName: yourName,
      instruments,
    });

    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    if (!result?.ok) {
      setBusy(false);
      setError(result?.message ?? "Could not create the program — try again.");
      return;
    }

    // Land in the program they just made (not the one they happened to be in),
    // then go where a director needs to be: the join code and the roster.
    await app.refresh(result.program_id ?? undefined);
    setBusy(false);
    toast.success("Your program is ready — share its join code with your students.");
    navigate("/roster");
  }

  const form = (
    <div className="cue-stagger mx-auto max-w-2xl space-y-5 px-4 py-5 pb-10 sm:px-6 sm:py-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <PageHeader
        kicker="New program"
        title="Start your own program"
        note="Name it, list its instruments, and you're its director. Nobody has to approve you, and the roster, attendance and live check-in tools are ready as soon as it exists."
      />

      <Field label="Program name" hint="What everybody will call it — you can be specific.">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jazz Ensemble"
          maxLength={80}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Short name"
        hint="Optional — shown where space is tight, like the app bar. Blank uses the full name."
      >
        <Input
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          placeholder="Jazz"
          maxLength={40}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Instruments"
        hint="What's in this program. Each one becomes a section your students can be put into."
      >
        <InstrumentPicker value={instruments} onChange={setInstruments} disabled={busy} />
      </Field>

      {needsName ? (
        <Field label="Your name" hint="Your students see this on the roster.">
          <Input
            value={yourName}
            onChange={(e) => setYourName(e.target.value)}
            placeholder="Alex Rivera"
            maxLength={80}
            autoComplete="name"
          />
        </Field>
      ) : null}

      <Button block size="lg" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
        Create my program
      </Button>

      {!standalone ? (
        <Button block variant="ghost" onClick={() => navigate(-1)}>
          Not now
        </Button>
      ) : null}

      <Card className="flex items-start gap-3">
        <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cue-gold)]" />
        <p className="text-sm text-[var(--cue-muted)]">
          It starts closed. Your program gets its own join code, and only the people you give that
          code to can join it — you can replace the code whenever you like on the Roster screen.
        </p>
      </Card>

      <Card className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cue-subtle)]" />
        <p className="type-meta">
          You become the director of this program only. Nothing here can change your access to
          somebody else&rsquo;s program — that is a director&rsquo;s decision, made on their roster.
        </p>
      </Card>
    </div>
  );

  if (!standalone) return form;

  return (
    <div className="safe-t flex min-h-full flex-col bg-[var(--cue-page)]">
      <div className="bg-[var(--cue-brand-panel)] px-6 pt-8 pb-6 text-[var(--cue-brand-ink)]">
        <img src="/logo.svg" alt="" className="h-9 w-9" />
        <p className="type-label mt-3 text-[var(--cue-gold-on-brand)]">{ORG_NAME}</p>
        <p className="type-title mt-1.5">{APP_NAME}</p>
        <p className="mt-1 max-w-md text-sm text-[var(--cue-brand-ink)]/80">
          You&rsquo;re signed in — name a program and you&rsquo;re its director straight away.
        </p>
      </div>

      <div className="flex-1">{form}</div>

      <div className="space-y-3 px-6 pb-6">
        <Button block variant="secondary" onClick={() => navigate("/join")}>
          Join a program with a code instead
        </Button>
        <Button
          block
          variant="ghost"
          icon={<LogOut className="h-4 w-4" />}
          onClick={() => void auth.signOut()}
        >
          Sign out
        </Button>
        {auth.email ? (
          <p className="type-meta text-center">Signed in as {auth.email}</p>
        ) : null}
      </div>
    </div>
  );
}
