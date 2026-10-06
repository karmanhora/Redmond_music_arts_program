import { SignIn, SignUp } from "@clerk/clerk-react";
import { useLocation } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { CalendarDays, ChevronRight, Music2, ScanLine } from "lucide-react";
import { Badge } from "../components/ui";
import { APP_NAME, PLATFORM_NAME } from "../lib/constants";

/**
 * Public entry point. Clerk is still the auth system, but the page now frames it
 * as the Music & Arts attendance hub rather than a Band-only sign-in screen.
 */
export function WelcomeScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");
  const afterAuth = token ? `/checkin?token=${encodeURIComponent(token)}` : "/";

  const appearance = {
    variables: {
      colorPrimary: "var(--band-primary)",
      colorText: "var(--band-ink)",
      colorBackground: "#ffffff",
      borderRadius: "0.75rem",
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
    },
    elements: {
      rootBox: "w-full",
      card: "shadow-none border-0 bg-transparent p-0 w-full",
      headerTitle: "hidden",
      headerSubtitle: "hidden",
      socialButtonsBlockButton:
        "h-11 rounded-xl border border-black/10 hover:bg-black/[0.03]",
      formButtonPrimary:
        "h-11 rounded-xl bg-band text-sm font-semibold normal-case hover:bg-band-deep",
      formFieldInput: "h-11 rounded-xl border-black/10",
      footerActionLink: "text-band font-semibold",
      footer: "bg-transparent",
    },
  } as const;

  return (
    <div className="min-h-full overflow-y-auto bg-[#f7f7f3] text-zinc-950 dark:bg-[#10110f] dark:text-zinc-100">
      <section className="safe-t relative isolate overflow-hidden border-b border-black/5 bg-[#171914] text-white dark:border-white/10">
        <MusicalNotes />
        <div className="relative mx-auto grid min-h-[560px] max-w-6xl items-center gap-8 px-5 py-10 md:grid-cols-[1fr_420px] md:px-8">
          <div className="max-w-3xl py-6">
            <p className="text-xs font-bold tracking-widest text-amber-200 uppercase">
              {APP_NAME}
            </p>
            <h1 className="mt-3 max-w-4xl text-4xl leading-[1.02] font-black tracking-tight sm:text-5xl lg:text-6xl">
              {PLATFORM_NAME}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-white/78">
              Access attendance for your music and arts events in one place.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={mode === "sign-in" ? "#sign-in" : "/sign-in"}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-zinc-950 transition hover:bg-amber-100"
              >
                Sign In
                <ChevronRight className="h-4 w-4" />
              </a>
              <a
                href="#programs"
                className="inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-bold text-white ring-1 ring-white/25 transition hover:bg-white/10"
              >
                View Programs
              </a>
            </div>
          </div>

          <div
            id="sign-in"
            className="rounded-2xl bg-white p-4 text-zinc-950 shadow-2xl ring-1 ring-black/10 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-white/10"
          >
            {mode === "sign-in" ? (
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
            <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {mode === "sign-in" ? (
                <>
                  New to a program?{" "}
                  <a className="font-semibold text-band underline dark:text-emerald-300" href="/sign-up">
                    Create your account
                  </a>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <a className="font-semibold text-band underline dark:text-emerald-300" href="/sign-in">
                    Sign in
                  </a>
                </>
              )}
            </p>
            <p className="mt-2 text-center text-[11px] text-zinc-400">
              Ask your director for your program&rsquo;s join code before you sign up.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-5 py-10 md:px-8">
        <section className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">
              What this platform does
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">
              One place to keep track of the rehearsals, performances, and events that matter to your program.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoTile icon={<Music2 className="h-5 w-5" />} title="Programs" body="Open the tracker for the program you are involved in." />
            <InfoTile icon={<CalendarDays className="h-5 w-5" />} title="Events" body="See upcoming rehearsals, performances and program dates." />
            <InfoTile icon={<ScanLine className="h-5 w-5" />} title="Check-in" body="Use QR check-in where your program has enabled it." />
          </div>
        </section>

        <section id="programs" className="space-y-3">
          <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">Programs</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ProgramTile name="Band" status="Available" active />
            <ProgramTile name="Orchestra" status="Coming soon" />
            <ProgramTile name="Choir" status="Coming soon" />
            <ProgramTile name="Drama" status="Coming soon" />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <HowStep step="1" title="Sign in" body="Access your RHS Music & Arts account." />
          <HowStep step="2" title="Choose your program" body="Open the attendance tracker for your program." />
          <HowStep step="3" title="Stay on track" body="View upcoming events and attendance history." />
        </section>

        <section className="grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <Badge className="bg-band text-white">Band showcase</Badge>
            <h2 className="mt-3 text-2xl font-black tracking-tight">Band attendance is available now.</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
              The existing Band tracker remains the first full implementation, including events, roster, calendar, QR check-in and attendance tools.
            </p>
          </div>
          <a
            href="#sign-in"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-bold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Access your attendance
            <ChevronRight className="h-4 w-4" />
          </a>
        </section>
      </div>
    </div>
  );
}

function MusicalNotes() {
  const notes = ["♪", "♩", "♫", "♬", "𝄞", "𝄽", "♭", "♯"];
  return (
    <div className="musical-notes" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          style={
            {
              "--i": i,
              "--x": `${(i * 13 + 4) % 100}%`,
              "--y": `${(i * 17 + 8) % 100}%`,
              "--drift": `${(i % 7) * 18}px`,
              "--size": `${1.1 + (i % 5) * 0.48}rem`,
              "--duration": `${14 + (i % 6) * 2}s`,
              "--delay": `${i * -0.9}s`,
              "--angle": `${(i - 10) * 4}deg`,
              "--angle-mid": `${(i - 4) * -3}deg`,
              "--angle-late": `${i * 2}deg`,
            } as CSSProperties
          }
        >
          {notes[i % notes.length]}
        </span>
      ))}
    </div>
  );
}

function InfoTile({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
        {icon}
      </span>
      <p className="mt-3 font-bold">{title}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{body}</p>
    </div>
  );
}

function ProgramTile({ name, status, active = false }: { name: string; status: string; active?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{name}</h3>
          <p className="mt-1 text-sm text-zinc-500">{active ? "Attendance & Events" : "Future program"}</p>
        </div>
        <Badge className={active ? "bg-band text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}>
          {status}
        </Badge>
      </div>
    </div>
  );
}

function HowStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-sm font-black text-zinc-950">
        {step}
      </span>
      <h3 className="mt-3 font-black">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{body}</p>
    </div>
  );
}
