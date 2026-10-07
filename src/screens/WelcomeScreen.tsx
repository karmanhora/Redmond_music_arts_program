import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Moon, QrCode, Sun } from "lucide-react";
import { IconButton } from "../components/ui";
import { APP_NAME } from "../lib/constants";
import { useDark } from "../hooks/useDark";

const programs = [
  {
    name: "ORCHESTRA",
    detail: "Strings • Ensembles • Concerts",
    tone: "orchestra",
  },
  {
    name: "BAND",
    detail: "Marching • Concert • Events",
    tone: "band",
  },
  {
    name: "CHOIR",
    detail: "Vocal • Performance • Events",
    tone: "choir",
  },
  {
    name: "DRAMA",
    detail: "Theatre • Productions • Events",
    tone: "drama",
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
                <span className="block">Redmond</span>
                <span className="block text-[var(--cue-gold)]">Music &amp; Arts</span>
                <span className="block">Attendance</span>
              </h1>
              <div className="landing-meta mt-6 flex flex-wrap items-center gap-4 text-[10px] font-bold tracking-[0.18em] text-white/80 uppercase sm:text-[11px]">
                <span>Music &amp; Arts Program</span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--cue-gold)]" />
                  Attendance Network
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--cue-gold)] opacity-80" />
                  System Online
                </span>
              </div>
              <div className="landing-actions mt-8 flex flex-wrap gap-3">
                <Link
                  viewTransition
                  to="/sign-in"
                  className="motion-press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-white px-5 text-sm font-bold text-[var(--cue-action-hover)] hover:bg-[#f1f0e9]"
                >
                  Enter attendance
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
                Built for rehearsal rhythm, section readiness, and live event attendance across RHS music and arts programs.
              </p>
            </div>

            <section
              aria-label="Example of the director check-in view"
              className="landing-panel cue-card relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-[var(--cue-panel)] text-[var(--cue-ink)] shadow-[0_30px_80px_rgba(0,0,0,0.2)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-[var(--cue-border)] px-4 py-3 sm:px-5">
                <span className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                  Attendance live
                </span>
                <span className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-[var(--cue-green)] uppercase">
                  <span className="h-2 w-2 rounded-full bg-[var(--cue-green)]" />
                  system online
                </span>
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 text-[11px] font-bold tracking-[0.18em] text-[var(--cue-muted)] uppercase">
                  <span>Wind Ensemble</span>
                  <span>Today · 3:30 PM</span>
                </div>
                <h2 className="mt-3 font-display text-4xl leading-none font-bold uppercase tracking-[-0.04em] sm:text-5xl">
                  Rehearsal sync
                </h2>
                <div className="mt-5 rounded-[1rem] border border-[var(--cue-border)] bg-[var(--cue-raised)] p-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="font-display text-6xl leading-none font-bold tabular-nums tracking-[-0.06em]">
                        27<span className="text-3xl text-[var(--cue-muted)]"> / 32</span>
                      </p>
                      <p className="mt-1 text-xs font-semibold tracking-[0.12em] text-[var(--cue-muted)] uppercase">
                        musicians checked in
                      </p>
                    </div>
                    <p className="font-display text-4xl leading-none font-bold tabular-nums text-[var(--cue-green)]">
                      84%
                    </p>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--cue-border)]">
                    <div className="h-full w-[84%] rounded-full bg-[linear-gradient(90deg,var(--cue-green),var(--cue-gold))]" />
                  </div>
                </div>
                <ul className="mt-4 space-y-2" aria-label="Example check-ins">
                  {[
                    ["Maya Chen", "On time"],
                    ["Eli", "On time"],
                    ["Anastasia Petrova", "Expected"],
                  ].map(([name, status]) => (
                    <li
                      key={name}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-[0.75rem] border border-[var(--cue-border)] bg-white/40 px-3 text-sm dark:bg-white/5"
                    >
                      <span className="truncate font-semibold">{name}</span>
                      <span
                        className={
                          status === "On time"
                            ? "flex shrink-0 items-center gap-1.5 text-[var(--cue-green)]"
                            : "shrink-0 font-semibold text-[var(--cue-muted)]"
                        }
                      >
                        {status === "On time" ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                        {status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </section>

        <div className="music-engine mx-auto flex max-w-7xl items-center justify-center gap-3 overflow-hidden px-5 py-5 text-[10px] font-bold tracking-[0.24em] text-[var(--cue-muted)] uppercase sm:px-8">
          <span>STAFF</span>
          <span className="music-engine-arrow">↓</span>
          <span>WAVEFORM</span>
          <span className="music-engine-arrow">↓</span>
          <span>TIMELINE</span>
          <span className="music-engine-arrow">↓</span>
          <span>ATTENDANCE GRAPH</span>
        </div>

        <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-[11px] font-bold tracking-[0.18em] text-[var(--cue-action)] uppercase">
              program network
            </p>
            <h2 className="mt-2 font-display text-4xl font-bold uppercase tracking-[-0.05em] sm:text-5xl">
              Four programs. One shared rhythm.
            </h2>
          </div>
          <div className="program-grid grid gap-5 lg:grid-cols-4">
            {programs.map((program) => (
              <article key={program.name} className={`program-card ${program.tone}`}>
                <div className="program-art" aria-hidden="true">
                  <span className="program-staff" />
                  <span className="program-staff" />
                  <span className="program-note" />
                  <span className="program-wave" />
                </div>
                <div className="program-body">
                  <div className="program-header">
                    <p className="program-name">{program.name}</p>
                    <span className="program-arrow">→</span>
                  </div>
                  <p className="program-detail">{program.detail}</p>
                  <div className="program-link">
                    Enter program
                    <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-12 sm:px-8 sm:pb-16">
          <div className="attendance-shell rounded-[2rem] border border-[var(--cue-border)] bg-[var(--cue-panel)] p-5 shadow-[0_25px_70px_rgba(17,23,19,0.08)] sm:p-8 lg:p-10">
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[11px] font-bold tracking-[0.2em] text-[var(--cue-action)] uppercase">
                  attendance system
                </p>
                <h2 className="mt-2 font-display text-4xl font-bold uppercase tracking-[-0.05em] sm:text-5xl">
                  Live coverage for every performance.
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold tracking-[0.18em] text-[var(--cue-muted)] uppercase">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--cue-green)]" />
                  System online
                </span>
                <span>04 programs</span>
                <span>Live events</span>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[1.5rem] border border-[var(--cue-border)] bg-[var(--cue-raised)] p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--cue-muted)] uppercase">
                      attendance tracking
                    </p>
                    <p className="mt-2 font-display text-3xl font-bold uppercase tracking-[-0.04em]">
                      18 events live
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--cue-border)] bg-white px-3 py-1 text-[10px] font-bold tracking-[0.16em] uppercase text-[var(--cue-action)]">
                    +21% this week
                  </span>
                </div>
                <div className="mt-6 space-y-4">
                  {[82, 71, 89, 64].map((value, index) => (
                    <div key={value}>
                      <div className="mb-2 flex items-center justify-between text-xs font-bold tracking-[0.12em] text-[var(--cue-muted)] uppercase">
                        <span>{["Orchestra", "Band", "Choir", "Drama"][index]}</span>
                        <span>{value}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--cue-border)]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--cue-green),var(--cue-gold))]"
                          style={{ width: `${value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-[var(--cue-border)] bg-[var(--cue-brand-panel)] p-5 text-[var(--cue-brand-ink)]">
                <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--cue-gold)] uppercase">
                  performance pulse
                </p>
                <div className="mt-5 flex items-end gap-3">
                  {[36, 54, 72, 48, 78, 60, 94].map((height, index) => (
                    <span
                      key={height}
                      className="pulse-bar"
                      style={{ height: `${height}%`, animationDelay: `${index * 100}ms` }}
                    />
                  ))}
                </div>
                <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/15 pt-4 text-[10px] font-bold tracking-[0.18em] uppercase text-white/80">
                  <span>Check-in flow</span>
                  <span>Live</span>
                </div>
              </div>
            </div>
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
