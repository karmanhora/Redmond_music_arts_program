import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Moon, QrCode, Sun } from "lucide-react";
import { IconButton } from "../components/ui";
import { APP_NAME } from "../lib/constants";
import { useDark } from "../hooks/useDark";

/** Public landing page for the RHS Music & Arts attendance platform. */
export function WelcomeScreen() {
  const { dark, toggle } = useDark();
  return (
    <div className="min-h-full overflow-y-auto bg-[var(--cue-page)] text-[var(--cue-ink)]">
      <header className="safe-t mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold tracking-[0.12em] text-[var(--cue-muted)] uppercase">
            Redmond High School
          </p>
          <p className="text-sm font-semibold">Music &amp; Arts</p>
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
        <section className="cue-hero relative isolate overflow-hidden bg-[var(--cue-brand-panel)] text-[var(--cue-brand-ink)]">
          <svg
            aria-hidden="true"
            className="cue-music-score pointer-events-none absolute z-[-1]"
            fill="none"
            viewBox="0 0 720 300"
          >
            <g className="cue-score-staves" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 86 694 42" />
              <path d="M21 111 697 67" />
              <path d="M24 136 700 92" />
              <path d="M27 161 703 117" />
              <path d="M30 186 706 142" />
            </g>
            <g className="cue-score-notes" fill="currentColor" stroke="currentColor" strokeWidth="4">
              <ellipse cx="151" cy="157" rx="13" ry="8" transform="rotate(-22 151 157)" />
              <path d="M164 155V58" />
              <path d="M164 59c34 8 39 29 17 45" fill="none" strokeWidth="7" />
              <ellipse cx="347" cy="127" rx="13" ry="8" transform="rotate(-22 347 127)" />
              <path d="M360 125V28" />
              <path d="M360 29c34 8 39 29 17 45" fill="none" strokeWidth="7" />
              <ellipse cx="534" cy="106" rx="13" ry="8" transform="rotate(-22 534 106)" />
              <path d="M547 104V7" />
              <path d="M547 8c34 8 39 29 17 45" fill="none" strokeWidth="7" />
            </g>
          </svg>
          <div className="cue-hero-layout mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16 lg:py-20">
            <div className="cue-hero-copy max-w-2xl">
              <p className="cue-hero-kicker text-xs font-bold tracking-[0.16em] text-amber-200 uppercase">
                {APP_NAME}
              </p>
              <h1 className="cue-hero-title mt-4 font-display text-6xl leading-[0.92] font-bold tracking-wide uppercase sm:text-7xl lg:text-8xl">
                Get the room ready.
              </h1>
              <p className="cue-hero-copyline mt-5 max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl">
                Attendance and check-in for the musicians, section leaders, and
                directors who make rehearsal happen.
              </p>
              <div className="cue-hero-actions mt-7 flex flex-wrap gap-3">
                <Link
                  viewTransition
                  to="/sign-in"
                  className="motion-press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-white px-5 text-sm font-bold text-[var(--cue-action-hover)] hover:bg-[#f1f0e9]"
                >
                  Open your program
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link
                  viewTransition
                  to="/sign-up"
                  className="motion-press inline-flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-white/45 px-5 text-sm font-bold text-white hover:bg-white/10"
                >
                  Create an account
                </Link>
              </div>
              <p className="cue-hero-note mt-4 max-w-lg text-sm text-white/75">
                New to the program? Ask your director for a join code before
                creating an account.
              </p>
            </div>

            <section
              aria-label="Example of the director check-in view"
              className="cue-hero-preview cue-card overflow-hidden rounded-[var(--radius-panel)] text-[var(--cue-ink)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--cue-border)] px-4 py-3 sm:px-5">
                <span className="font-display text-lg font-bold tracking-wide uppercase">
                  Example check-in
                </span>
                <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wide text-[var(--cue-green)] uppercase">
                  <span className="h-2 w-2 rounded-full bg-[var(--cue-green)]" />
                  Rehearsal
                </span>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-sm font-semibold text-[var(--cue-muted)]">
                  WIND ENSEMBLE · TODAY, 3:30 PM
                </p>
                <h2 className="mt-2 font-display text-3xl leading-tight font-bold sm:text-4xl">
                  Wind Ensemble Rehearsal
                </h2>
                <div className="mt-5 flex items-end justify-between gap-4 border-y border-[var(--cue-border)] py-4">
                  <div>
                    <p className="font-display text-6xl leading-none font-bold tabular-nums">
                      27<span className="text-3xl text-[var(--cue-muted)]"> / 32</span>
                    </p>
                    <p className="mt-1 text-sm text-[var(--cue-muted)]">musicians checked in</p>
                  </div>
                  <p className="font-display text-4xl leading-none font-bold tabular-nums text-[var(--cue-green)]">
                    84%
                  </p>
                </div>
                <ul className="mt-3 divide-y divide-[var(--cue-border)]" aria-label="Example check-ins">
                  <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate font-semibold">Maya Chen</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[var(--cue-green)]">
                      <Check aria-hidden="true" className="h-4 w-4" />
                      On time
                    </span>
                  </li>
                  <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate font-semibold">Eli</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[var(--cue-green)]">
                      <Check aria-hidden="true" className="h-4 w-4" />
                      On time
                    </span>
                  </li>
                  <li className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate font-semibold">Anastasia Petrova</span>
                    <span className="shrink-0 font-semibold text-[var(--cue-muted)]">
                      Expected
                    </span>
                  </li>
                </ul>
                <p className="mt-3 border-t border-[var(--cue-border)] pt-3 text-xs leading-relaxed text-[var(--cue-muted)]">
                  Sample names and counts shown for illustration.
                </p>
              </div>
            </section>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <p className="font-display text-lg font-bold tracking-wide text-[var(--cue-action)] uppercase">
              Made for rehearsal days
            </p>
            <h2 className="mt-2 max-w-md font-display text-4xl leading-tight font-bold uppercase sm:text-5xl">
              Less roll call. More music.
            </h2>
          </div>
          <ol className="divide-y divide-[var(--cue-border)] border-y border-[var(--cue-border)]">
            <li className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
              <span className="font-display text-lg font-bold tracking-wide text-[var(--cue-action)] uppercase">
                Students
              </span>
              <p className="text-[var(--cue-muted)]">
                Find the next event, check in with a scan or code, and see your
                attendance history.
              </p>
            </li>
            <li className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
              <span className="font-display text-lg font-bold tracking-wide text-[var(--cue-action)] uppercase">
                Directors
              </span>
              <p className="text-[var(--cue-muted)]">
                Put the check-in code on the screen, watch the roster fill in,
                and follow up with the sections still on their way.
              </p>
            </li>
            <li className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
              <span className="font-display text-lg font-bold tracking-wide text-[var(--cue-action)] uppercase">
                One program
              </span>
              <p className="text-[var(--cue-muted)]">
                Events, calendar, roster, and attendance stay together for your
                music and arts program.
              </p>
            </li>
          </ol>
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
