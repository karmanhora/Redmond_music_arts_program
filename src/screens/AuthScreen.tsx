import { useEffect, useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SegmentedControl } from "../components/ui";
import { APP_NAME, readAuthAudience, writeAuthAudience } from "../lib/constants";
import type { AuthAudience } from "../lib/constants";

type AuthMode = "sign-in" | "sign-up";

/**
 * Copy that changes with the audience picked above the form. The Clerk form
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
    signInSub: "Use the email your program’s director has on file for you.",
    signUpSub:
      "Use your school email if you have one — your director will match it to your program.",
    signUpNote:
      "After creating your account, join your program with its code. Your director then adds you to the staff roster, which unlocks the roster, attendance, and live check-in tools.",
  },
};

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const [params, setParams] = useSearchParams();
  const token = params.get("token");
  const afterAuth = token ? `/checkin?token=${encodeURIComponent(token)}` : "/";
  const isSignIn = mode === "sign-in";

  // A shared ?role=… link wins, then the tab's remembered choice, then student.
  const [audience, setAudience] = useState<AuthAudience>(() => {
    const fromUrl = params.get("role");
    if (fromUrl === "teacher" || fromUrl === "student") return fromUrl;
    return readAuthAudience();
  });

  const copy = AUDIENCE_COPY[audience];

  // Seed the session from whatever won (URL param, then remembered choice), so
  // Clerk's own sign-in ↔ sign-up links — which drop the query string — keep
  // showing the same audience's copy.
  useEffect(() => {
    writeAuthAudience(audience);
  }, [audience]);

  /** Remembered in the URL (shareable) and the session (survives Clerk's links). */
  function chooseAudience(next: AuthAudience): void {
    if (next === audience) return;
    setAudience(next);
    writeAuthAudience(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set("role", next);
    setParams(nextParams, { replace: true });
  }

  const appearance = {
    variables: {
      colorPrimary: "var(--band-primary)",
      colorText: "var(--cue-ink)",
      colorBackground: "var(--cue-panel)",
      borderRadius: "var(--radius-control)",
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
    },
    elements: {
      rootBox: "w-full",
      card: "shadow-none border-0 bg-transparent p-0 w-full",
      headerTitle: "hidden",
      headerSubtitle: "hidden",
      socialButtonsBlockButton:
        "min-h-11 rounded-[var(--radius-control)] border border-[var(--cue-border)] hover:bg-[var(--cue-raised)]",
      formButtonPrimary:
        "min-h-11 rounded-[var(--radius-control)] bg-band text-sm font-semibold normal-case hover:bg-band-deep",
      formFieldInput:
        "min-h-11 rounded-[var(--radius-control)] border-[var(--cue-border)] bg-[var(--cue-panel)]",
      footerActionLink: "font-semibold text-[var(--cue-green)]",
      footer: "bg-transparent",
    },
  } as const;

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
              {isSignIn ? "Sign in to your program." : "Join your program."}
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--cue-brand-ink)]/80">
              {isSignIn
                ? "Your events, check-in, and attendance are waiting here."
                : "Create your account, then enter the join code your director shared."}
            </p>
          </div>
          <p className="mt-8 text-xs font-semibold tracking-wide text-[var(--cue-brand-ink)]/65">
            REDMOND HIGH SCHOOL · MUSIC &amp; ARTS
          </p>
        </aside>

        <section className="flex items-center justify-center px-5 py-8 sm:px-9 sm:py-10 md:px-12">
          <div className="cue-stagger w-full max-w-md">
            <SegmentedControl
              className="mb-5"
              value={audience}
              onChange={chooseAudience}
              options={[
                { value: "student", label: "I’m a student" },
                { value: "teacher", label: "I’m a teacher" },
              ]}
            />

            {/* Keyed to the audience: the copy re-reveals on a switch while
                the Clerk form below stays mounted with everything typed. */}
            <div key={audience}>
              <p className="font-display text-lg font-bold tracking-wide text-[var(--cue-green)] uppercase">
                {isSignIn ? copy.kickerIn : copy.kickerUp}
              </p>
              <h2 className="mt-1 font-display text-4xl leading-none font-bold uppercase">
                {isSignIn ? "Sign in" : "Create your account"}
              </h2>
              <p className="mt-2 text-sm text-[var(--cue-muted)]">
                {isSignIn ? copy.signInSub : copy.signUpSub}
              </p>
            </div>

            <div className="mt-6">
              {isSignIn ? (
                <SignIn
                  routing="path"
                  path="/sign-in"
                  signUpUrl="/sign-up"
                  forceRedirectUrl={afterAuth}
                  appearance={appearance}
                />
              ) : (
                <SignUp
                  routing="path"
                  path="/sign-up"
                  signInUrl="/sign-in"
                  forceRedirectUrl={afterAuth}
                  appearance={appearance}
                />
              )}
            </div>

            {!isSignIn ? (
              <p className="mt-3 text-center text-sm leading-relaxed text-[var(--cue-muted)]">
                {copy.signUpNote}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
