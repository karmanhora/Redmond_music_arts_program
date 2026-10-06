import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Music2, ScanLine } from "lucide-react";
import { Badge } from "../components/ui";
import { APP_NAME, PLATFORM_NAME } from "../lib/constants";

/** Public landing page for the RHS Music & Arts attendance platform. */
export function WelcomeScreen() {
  return (
    <div className="min-h-full overflow-y-auto bg-[#f7f7f3] text-zinc-950 dark:bg-[#10110f] dark:text-zinc-100">
      <section className="safe-t relative isolate overflow-hidden border-b border-black/5 bg-[#171914] text-white dark:border-white/10">
        <MusicalNotes />
        <div className="relative mx-auto grid min-h-[440px] max-w-6xl items-center gap-8 px-5 py-12 md:grid-cols-[1fr_360px] md:px-8">
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
              <Link
                to="/sign-in"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-zinc-950 transition hover:bg-amber-100"
              >
                Sign in
                <ChevronRight className="h-4 w-4" />
              </Link>
              <Link
                to="/sign-up"
                className="inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-bold text-white ring-1 ring-white/25 transition hover:bg-white/10"
              >
                Create an account
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-white/10 p-5 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300 text-zinc-950">
              <Music2 className="h-6 w-6" />
            </span>
            <p className="mt-4 text-lg font-black">Your program, in tune.</p>
            <p className="mt-1 text-sm leading-relaxed text-white/70">
              One account for rehearsals, performances, attendance, and check-in.
            </p>
            <div className="mt-5 border-t border-white/15 pt-4 text-sm text-white/80">
              New here? Get your program join code from your director before
              creating an account.
            </div>
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
              One place to keep track of the rehearsals, performances, and
              events that matter to your program.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoTile
              icon={<Music2 className="h-5 w-5" />}
              title="Programs"
              body="Open the tracker for the program you are involved in."
            />
            <InfoTile
              icon={<CalendarDays className="h-5 w-5" />}
              title="Events"
              body="See upcoming rehearsals, performances and program dates."
            />
            <InfoTile
              icon={<ScanLine className="h-5 w-5" />}
              title="Check-in"
              body="Use QR check-in where your program has enabled it."
            />
          </div>
        </section>

        <section id="programs" className="space-y-3">
          <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">
            Programs
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ProgramTile name="Band" status="Available" active />
            <ProgramTile name="Orchestra" status="Coming soon" />
            <ProgramTile name="Choir" status="Coming soon" />
            <ProgramTile name="Drama" status="Coming soon" />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <HowStep
            step="1"
            title="Create your account"
            body="Use your email and your program's join code."
          />
          <HowStep
            step="2"
            title="Choose your program"
            body="Open the attendance tracker for your program."
          />
          <HowStep
            step="3"
            title="Stay on track"
            body="View upcoming events and attendance history."
          />
        </section>

        <section className="grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <Badge className="bg-band text-white">Band showcase</Badge>
            <h2 className="mt-3 text-2xl font-black tracking-tight">
              Band attendance is available now.
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
              The Band tracker includes events, roster, calendar, QR check-in,
              and attendance tools.
            </p>
          </div>
          <Link
            to="/sign-in"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-bold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Access your attendance
            <ChevronRight className="h-4 w-4" />
          </Link>
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

function InfoTile({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
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

function ProgramTile({
  name,
  status,
  active = false,
}: {
  name: string;
  status: string;
  active?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{name}</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {active ? "Attendance & Events" : "Future program"}
          </p>
        </div>
        <Badge
          className={
            active
              ? "bg-band text-white"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          }
        >
          {status}
        </Badge>
      </div>
    </div>
  );
}

function HowStep({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
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
