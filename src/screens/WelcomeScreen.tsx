import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarDays,
  Camera,
  ClipboardCheck,
  Moon,
  QrCode,
  Sun,
  Users,
} from "lucide-react";
import { IconButton } from "../components/ui";
import { APP_NAME } from "../lib/constants";
import { useDark } from "../hooks/useDark";

const programs = [
  {
    name: "Band",
    detail: "RHS Mustang Bands",
    summary: "Attendance and event tools for RHS band members and directors.",
    instagram: "https://www.instagram.com/rhsmustangbands/",
    attendance: true,
  },
  {
    name: "Orchestra",
    detail: "RHS Strings",
    summary: "Follow the RHS orchestra community and stay up to date with performances.",
    instagram: "https://www.instagram.com/rhs.strings/",
    attendance: false,
  },
];

/** Public landing page for the RHS Music & Arts attendance platform. */
export function WelcomeScreen() {
  const { dark, toggle } = useDark();

  return (
    <div className="landing-shell min-h-full overflow-x-hidden bg-[var(--cue-page)] text-[var(--cue-ink)]">
      <header className="safe-t mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold tracking-[0.2em] text-[var(--cue-muted)] uppercase sm:text-xs">
            Redmond High School
          </p>
          <p className="text-sm font-semibold tracking-[0.12em] text-[var(--cue-ink)] uppercase">
            Music &amp; Arts
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            label={dark ? "Use light mode" : "Use dark mode"}
            onClick={toggle}
            icon={dark ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
          />
          <Link
            viewTransition
            to="/sign-in"
            className="motion-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--cue-action)] px-4 text-sm font-bold text-white hover:bg-[var(--cue-action-hover)]"
          >
            Sign in
            <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero relative isolate overflow-hidden bg-[var(--cue-brand-panel)] text-[var(--cue-brand-ink)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(213,163,58,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(255,255,255,0.08),transparent_28%)]" />
          <svg
            aria-hidden="true"
            className="landing-score pointer-events-none absolute inset-y-0 right-[-12%] w-[78%] max-w-[780px] opacity-70"
            fill="none"
            viewBox="0 0 760 420"
          >
            <g stroke="currentColor" strokeWidth="1.4" opacity="0.75">
              <path d="M30 86H700" />
              <path d="M32 122H703" />
              <path d="M36 158H708" />
              <path d="M40 194H712" />
              <path d="M45 230H716" />
            </g>
            <g fill="currentColor" stroke="currentColor" strokeWidth="2.8">
              <ellipse cx="150" cy="180" rx="12" ry="9" transform="rotate(-14 150 180)" />
              <path d="M157 178V78" />
              <path d="M157 80c22 6 32 17 22 36" fill="none" strokeWidth="6" />
              <ellipse cx="332" cy="150" rx="12" ry="9" transform="rotate(-14 332 150)" />
              <path d="M339 148V32" />
              <path d="M339 34c22 6 32 17 22 36" fill="none" strokeWidth="6" />
              <ellipse cx="512" cy="128" rx="12" ry="9" transform="rotate(-14 512 128)" />
              <path d="M519 126V14" />
              <path d="M519 16c22 6 32 17 22 36" fill="none" strokeWidth="6" />
            </g>
          </svg>

          <div className="landing-hero-grid relative mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.12fr_0.88fr] lg:items-center lg:gap-16 lg:py-20">
            <div className="landing-copy max-w-2xl">
              <p className="landing-kicker text-[10px] font-bold tracking-[0.22em] text-[var(--cue-gold)] uppercase sm:text-xs">
                {APP_NAME}
              </p>
              <h1 className="landing-title mt-4 font-display text-5xl leading-[0.84] font-bold uppercase tracking-[-0.05em] sm:text-6xl lg:text-[7rem]">
                <span className="block">RHS Band</span>
                <span className="block text-[var(--cue-gold)]">Ready for</span>
                <span className="block">Rehearsal.</span>
              </h1>
              <div className="landing-actions mt-8 flex flex-wrap gap-3">
                <Link
                  viewTransition
                  to="/sign-in"
                  className="motion-press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-white px-5 text-sm font-bold text-[var(--cue-action-hover)] hover:bg-[#f1f0e9]"
                >
                  Sign in
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  viewTransition
                  to="/sign-up"
                  className="motion-press inline-flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-white/35 bg-white/5 px-5 text-sm font-bold text-white hover:bg-white/10"
                >
                  Create account
                </Link>
              </div>
              <p className="landing-note mt-5 max-w-lg text-sm leading-relaxed text-white/75">
                Events, quick check-in, and attendance in one place for RHS band members and directors.
              </p>
            </div>

            <section
              aria-label="Band attendance tools"
              className="landing-panel cue-card relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[var(--cue-panel)] text-[var(--cue-ink)] shadow-[0_30px_80px_rgba(0,0,0,0.2)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--cue-border)] px-4 py-3 sm:px-5">
                <span className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                  Your band, organized
                </span>
              </div>
              <div className="divide-y divide-[var(--cue-border)] p-4 sm:p-5">
                {[
                  {
                    icon: CalendarDays,
                    title: "Know what’s next",
                    detail: "See rehearsals and upcoming events.",
                  },
                  {
                    icon: ClipboardCheck,
                    title: "Check in with ease",
                    detail: "Quick attendance check-in at each event.",
                  },
                  {
                    icon: Users,
                    title: "Stay in sync",
                    detail: "Members and directors share one roster.",
                  },
                ].map(({ icon: Icon, title, detail }) => (
                  <div key={title} className="flex items-center gap-4 py-4 first:pt-1 last:pb-1">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cue-raised)] text-[var(--cue-green)]">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-semibold">{title}</p>
                      <p className="mt-1 text-sm text-[var(--cue-muted)]">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section id="programs" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-[11px] font-bold tracking-[0.18em] text-[var(--cue-action)] uppercase">
              RHS music
            </p>
            <h2 className="mt-2 font-display text-4xl font-bold uppercase tracking-[-0.05em] sm:text-5xl">
              Find your music community.
            </h2>
            <p className="mt-3 max-w-2xl text-[var(--cue-muted)]">
              Open the band attendance app or follow the official RHS music program pages.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {programs.map((program) => (
              <article
                key={program.name}
                className="flex min-h-64 flex-col justify-between rounded-[var(--radius-panel)] border border-[var(--cue-border)] bg-[var(--cue-panel)] p-6 shadow-[var(--elevation-panel)]"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold tracking-[0.16em] text-[var(--cue-action)] uppercase">
                        {program.attendance ? "Attendance app" : "RHS music"}
                      </p>
                      <h3 className="mt-2 font-display text-3xl font-bold uppercase">{program.name}</h3>
                    </div>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cue-raised)] text-[var(--cue-green)]">
                      <Camera aria-hidden="true" className="h-5 w-5" />
                    </span>
                  </div>
                  <p className="mt-2 font-semibold">{program.detail}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--cue-muted)]">{program.summary}</p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  {program.attendance ? (
                    <Link
                      viewTransition
                      to="/sign-in"
                      className="motion-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--cue-action)] px-4 text-sm font-bold text-white hover:bg-[var(--cue-action-hover)]"
                    >
                      Band sign in
                      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  ) : null}
                  <a
                    href={program.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Follow ${program.detail} on Instagram (opens in a new tab)`}
                    className="motion-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--cue-border)] px-4 text-sm font-bold text-[var(--cue-ink)] hover:bg-[var(--cue-raised)]"
                  >
                    Follow on Instagram
                    <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="border-t border-[var(--cue-border)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-sm text-[var(--cue-muted)] sm:px-8">
            <span>Redmond High School Music &amp; Arts</span>
            <Link
              viewTransition
              to="/sign-up"
              className="motion-press inline-flex min-h-11 items-center gap-2 font-bold text-[var(--cue-action)] underline decoration-[var(--cue-gold)] decoration-2 underline-offset-4"
            >
              Join your program
              <QrCode aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
