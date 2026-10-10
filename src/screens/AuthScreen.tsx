import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";
import { Alert, Button, Field, Input, SegmentedControl, useToast } from "../components/ui";
import { APP_NAME, readAuthAudience, writeAuthAudience } from "../lib/constants";
import type { AuthAudience } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";

type AuthMode = "sign-in" | "sign-up" | "forgot" | "reset";

/**
 * Copy that changes with the audience picked above the form. The form
 * underneath never remounts, so nothing typed is lost when the choice flips.
 */
const AUDIENCE_COPY: Record<
  AuthAudience,
  { kickerIn: string; kickerUp: string; signInSub: string; signUpSub: string; signUpNote: string }
> = {
  student: {
    kickerIn: "Returning student",
    kickerUp: "New student account",
    signInSub: "Use the email connected to your program.",
    signUpSub: "Use the email you want associated with your program.",
    signUpNote:
      "After creating your account, enter your program’s join code. Ask your director if you need one.",
  },
  teacher: {
    kickerIn: "Returning teacher",
    kickerUp: "New teacher account",
    signInSub: "Use the email you run your program with.",
    signUpSub:
      "Use your school email if you have one — you’ll name your own program next.",
    signUpNote:
      "Next you’ll name your program and become its director — no approval needed. The roster, attendance, and live check-in tools are yours as soon as it exists.",
  },
};

/** Headline, sub-heading and aside copy for each mode. */
const MODE_COPY: Record<AuthMode, { title: string; aside: string; asideSub: string }> = {
  "sign-in": {
    title: "Sign in",
    aside: "Sign in to your program.",
    asideSub: "Your events, check-in, and attendance are waiting here.",
  },
  "sign-up": {
    title: "Create your account",
    aside: "Join your program.",
    asideSub: "Create your account, then enter the join code your director shared.",
  },
  forgot: {
    title: "Reset your password",
    aside: "Forgot your password?",
    asideSub: "Tell us your email and we'll send you a link to set a new one.",
  },
  reset: {
    title: "Choose a new password",
    aside: "Set a new password.",
    asideSub: "Pick something you'll remember — then you're straight back to your attendance.",
  },
};

/**
 * The sign-in surface, in four modes: sign in, create an account, ask for a
 * password-reset link, and set a new password from that link.
 *
 * One component rather than four screens, because they are the same page: the
 * same branded panel, the same student/teacher choice, the same form controls —
 * only the fields and the words change. It replaces Clerk's hosted `<SignIn />`
 * / `<SignUp />` components with forms bound to Supabase Auth, keeping the
 * layout, the copy and the audience switch exactly as they were.
 */
export function AuthScreen({ mode }: { mode: AuthMode }) {
  const auth = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // A scanned QR code's deep link arrives as `/checkin?token=…`. Signing in has
  // to finish where the person was going, not on the home screen.
  const token = params.get("token");
  const afterAuth = token ? `/checkin?token=${encodeURIComponent(token)}` : null;

  const [audience, setAudience] = useState<AuthAudience>(() => {
    const fromUrl = params.get("role");
    if (fromUrl === "teacher" || fromUrl === "student") return fromUrl;
    return readAuthAudience();
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Sign-up with confirmation switched on: nothing to do but check the inbox. */
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  /** The one error that has an action attached ("Resend the link"). */
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [sent, setSent] = useState(false);

  const copy = AUDIENCE_COPY[audience];
  const headline = MODE_COPY[mode];

  useEffect(() => {
    writeAuthAudience(audience);
  }, [audience]);

  // Moving between modes must never carry an error or a half-filled form across.
  useEffect(() => {
    setError(null);
    setPassword("");
    setConfirm("");
    setNeedsConfirmation(false);
    setSent(false);
    setAwaitingEmail(false);
  }, [mode]);

  /** Remembered in the URL (shareable) and the session (survives a reload). */
  function chooseAudience(next: AuthAudience): void {
    if (next === audience) return;
    setAudience(next);
    writeAuthAudience(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set("role", next);
    setParams(nextParams, { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsConfirmation(false);

    if ((mode === "sign-up" || mode === "reset") && password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setBusy(true);

    if (mode === "sign-in") {
      const { error: failure } = await auth.signIn(email, password);
      setBusy(false);
      if (failure) {
        setError(failure);
        setNeedsConfirmation(/confirm your email/i.test(failure));
        return;
      }
      if (afterAuth) navigate(afterAuth, { replace: true });
      return;
    }

    if (mode === "sign-up") {
      const { error: failure, needsConfirmation } = await auth.signUp(email, password, audience);
      setBusy(false);
      if (failure) {
        setError(failure);
        return;
      }
      if (needsConfirmation) setAwaitingEmail(true);
      return;
    }

    if (mode === "forgot") {
      const { error: failure } = await auth.sendPasswordReset(email);
      setBusy(false);
      if (failure) {
        setError(failure);
        return;
      }
      setSent(true);
      return;
    }

    // mode === "reset"
    const { error: failure } = await auth.updatePassword(password);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    toast.success("Password updated.");
    auth.clearRecovery();
    navigate("/", { replace: true });
  }

  async function resend() {
    setBusy(true);
    const { error: failure } = await auth.resendConfirmation(email);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    toast.success("Sent — check your inbox.");
  }

  async function continueWithGoogle() {
    setError(null);
    setBusy(true);
    const redirectUrl = new URL(afterAuth ?? "/", window.location.origin);
    redirectUrl.searchParams.set("account_type", audience);
    const redirectTo = redirectUrl.toString();
    const { error: failure } = await auth.signInWithGoogle(redirectTo);
    if (failure) {
      setBusy(false);
      setError(failure);
    }
  }

  /* --- dead ends that deserve a whole panel rather than a form ------------ */

  if (mode === "reset" && !auth.userId) {
    return (
      <AuthLayout mode={mode}>
        <p className="font-display text-lg font-bold tracking-wide text-[var(--cue-green)] uppercase">
          Link expired
        </p>
        <h2 className="mt-1 font-display text-4xl leading-none font-bold uppercase">
          {headline.title}
        </h2>
        <p className="mt-2 text-sm text-[var(--cue-muted)]">
          That link has already been used, or it belongs to another browser. Ask for a fresh one and
          it will work.
        </p>
        <div className="mt-6 space-y-3">
          <Link to="/forgot-password" className="block">
            <Button block size="lg" icon={<KeyRound className="h-4 w-4" />}>
              Email me a new link
            </Button>
          </Link>
          <Link to="/sign-in" className="block">
            <Button block variant="secondary">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (awaitingEmail) {
    return (
      <AuthLayout mode={mode}>
        <MailCheck aria-hidden="true" className="h-8 w-8 text-[var(--cue-green)]" />
        <h2 className="mt-2 font-display text-4xl leading-none font-bold uppercase">
          Check your email
        </h2>
        <p className="mt-2 text-sm text-[var(--cue-muted)]">
          We sent a confirmation link to{" "}
          <span className="font-semibold text-[var(--cue-ink)]">{email.trim()}</span>. Open it and
          you&rsquo;re in — then enter your program&rsquo;s join code.
        </p>
        {error ? (
          <div className="mt-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <div className="mt-6 space-y-3">
          <Button block variant="secondary" loading={busy} onClick={() => void resend()}>
            Send it again
          </Button>
          <Link to="/sign-in" className="block">
            <Button block variant="ghost">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (sent) {
    return (
      <AuthLayout mode={mode}>
        <MailCheck aria-hidden="true" className="h-8 w-8 text-[var(--cue-green)]" />
        <h2 className="mt-2 font-display text-4xl leading-none font-bold uppercase">
          Check your email
        </h2>
        <p className="mt-2 text-sm text-[var(--cue-muted)]">
          If an account exists for{" "}
          <span className="font-semibold text-[var(--cue-ink)]">{email.trim()}</span>, a link to set
          a new password is on its way. It expires in an hour.
        </p>
        <div className="mt-6">
          <Link to="/sign-in" className="block">
            <Button block variant="secondary">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  /* --- the forms ---------------------------------------------------------- */

  const showsAudience = mode === "sign-in" || mode === "sign-up";
  const isSignIn = mode === "sign-in";

  return (
    <AuthLayout mode={mode}>
      {showsAudience ? (
        <SegmentedControl
          className="mb-5"
          value={audience}
          onChange={chooseAudience}
          options={[
            { value: "student", label: "I’m a student" },
            { value: "teacher", label: "I’m a teacher" },
          ]}
        />
      ) : null}

      {/* Keyed to the audience: the copy re-reveals on a switch while the form
          below stays mounted with everything typed. */}
      <div key={showsAudience ? audience : mode} className="cue-stagger">
        <p className="font-display text-lg font-bold tracking-wide text-[var(--cue-green)] uppercase">
          {isSignIn
            ? copy.kickerIn
            : mode === "sign-up"
              ? copy.kickerUp
              : mode === "forgot"
                ? "Password help"
                : "Recovery link"}
        </p>
        <h2 className="mt-1 font-display text-4xl leading-none font-bold uppercase">
          {isSignIn ? "Sign in" : headline.title}
        </h2>
        <p className="mt-2 text-sm text-[var(--cue-muted)]">
          {isSignIn
            ? copy.signInSub
            : mode === "sign-up"
              ? copy.signUpSub
              : headline.asideSub}
        </p>
      </div>

      <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </Field>

        {mode === "forgot" ? null : (
          <Field
            label={mode === "sign-in" ? "Password" : "New password"}
            hint={
              mode === "sign-in" ? undefined : "At least 8 characters, or whatever your director asked for."
            }
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isSignIn ? "current-password" : "new-password"}
              required
            />
          </Field>
        )}

        {mode === "sign-up" || mode === "reset" ? (
          <Field label="Confirm password">
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </Field>
        ) : null}

        <Button block size="lg" type="submit" loading={busy}>
          {isSignIn
            ? "Sign in"
            : mode === "sign-up"
              ? "Create account"
              : mode === "forgot"
                ? "Email me a link"
                : "Save and continue"}
        </Button>

        {needsConfirmation ? (
          <Button block variant="secondary" loading={busy} onClick={() => void resend()}>
            Resend the confirmation email
          </Button>
        ) : null}
      </form>

      {showsAudience ? (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-[var(--cue-muted)]">
            <span aria-hidden="true" className="h-px flex-1 bg-[var(--cue-border)]" />
            <span>or continue with</span>
            <span aria-hidden="true" className="h-px flex-1 bg-[var(--cue-border)]" />
          </div>
          <Button
            block
            variant="secondary"
            loading={busy}
            onClick={() => void continueWithGoogle()}
          >
            Continue with Google
          </Button>
        </>
      ) : null}

      <div className="mt-5 space-y-3 text-center text-sm">
        {mode === "sign-in" ? (
          <>
            <Link to="/forgot-password" className="font-semibold text-[var(--cue-green)] underline">
              Forgot your password?
            </Link>
            <Link to="/sign-up" className="block text-[var(--cue-muted)]">
              New here? <span className="font-semibold underline">Create an account</span>
            </Link>
          </>
        ) : null}

        {mode === "sign-up" ? (
          <Link to="/sign-in" className="block text-[var(--cue-muted)]">
            Already have an account? <span className="font-semibold underline">Sign in</span>
          </Link>
        ) : null}

        {mode === "forgot" || mode === "reset" ? (
          <Link to="/sign-in" className="block text-[var(--cue-muted)]">
            <span className="font-semibold underline">Back to sign in</span>
          </Link>
        ) : null}
      </div>

      {mode === "sign-up" ? (
        <p className="mt-3 text-center text-sm leading-relaxed text-[var(--cue-muted)]">
          {copy.signUpNote}
        </p>
      ) : null}
    </AuthLayout>
  );
}

/**
 * The two-panel shell every auth mode shares: the branded aside on the left with
 * a way back to the landing page, and the form in the panel on the right. Kept
 * identical to the pre-migration design on purpose — swapping the auth provider
 * is not a reason for the page to look different.
 */
function AuthLayout({ mode, children }: { mode: AuthMode; children: ReactNode }) {
  const copy = MODE_COPY[mode];

  return (
    <main className="safe-t flex min-h-full items-center justify-center overflow-y-auto bg-[var(--cue-page)] px-4 py-6 text-[var(--cue-ink)] sm:px-6 sm:py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[var(--radius-panel)] border border-[var(--cue-border)] bg-[var(--cue-panel)] shadow-sm md:min-h-[560px] md:grid-cols-[0.8fr_1.2fr]">
        <aside className="flex flex-col justify-between bg-[var(--cue-brand-panel)] p-5 text-[var(--cue-brand-ink)] sm:p-8 md:p-10">
          <div>
            <Link
              viewTransition
              to="/"
              className="motion-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-[var(--cue-brand-ink)]/80 hover:text-[var(--cue-brand-ink)]"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to the program
            </Link>
            <p className="mt-10 font-display text-lg font-bold tracking-wide text-amber-200 uppercase">
              {APP_NAME}
            </p>
            <h1 className="mt-3 max-w-sm font-display text-5xl leading-[0.95] font-bold uppercase sm:text-6xl">
              {copy.aside}
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--cue-brand-ink)]/80">
              {copy.asideSub}
            </p>
          </div>
          <p className="mt-8 text-xs font-semibold tracking-wide text-[var(--cue-brand-ink)]/65">
            REDMOND HIGH SCHOOL · MUSIC &amp; ARTS
          </p>
        </aside>

        <section className="flex items-center justify-center px-5 py-8 sm:px-9 sm:py-10 md:px-12">
          <div className="w-full max-w-md">{children}</div>
        </section>
      </div>
    </main>
  );
}
