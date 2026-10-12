import { Link } from "react-router-dom";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import { IconButton, Poster, StaffMotif } from "../components/ui";
import { useDark } from "../hooks/useDark";

/**
 * The public front door.
 *
 * It says three things and stops: what this is, what a member actually does
 * here, and where to sign in. The green panel is the program's own colour rather
 * than decoration, and there is no illustration, no gradient and no statistic —
 * the only numbers on this page are the ones a reader needs to act.
 *
 * The composition is deliberately not two columns of prose. The left column is
 * the promise, set in the poster voice the app reserves for the name of the
 * thing a screen is about; the right column is an ordered call sheet, because
 * the three things a member does here happen in that order. The staff motif
 * behind them is the same one the dashboard's focal panel uses, so the public
 * page and the product behind the sign-in look like one thing.
 */

/**
 * The three controls on this page, defined once each. A primary action is ink on
 * paper and white on the green panel — in both themes that is simply the highest
 * contrast surface available, which is why it needs no theme branch.
 */
const BTN =
  "motion-press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-sm font-semibold " +
  "transition-[background-color,color,box-shadow,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)] " +
  "hover:-translate-y-px active:translate-y-0";
const BTN_PRIMARY = `${BTN} min-h-11 bg-[var(--cue-ink)] px-3.5 text-[var(--cue-panel)] hover:opacity-90 sm:px-4`;
const BTN_ON_GREEN = `${BTN} min-h-12 bg-white px-5 text-[var(--cue-action-hover)] hover:bg-[#f1f0e9]`;
const BTN_OUTLINE = `${BTN} min-h-11 border border-[var(--cue-line-strong)] px-4 hover:bg-[var(--cue-raised)]`;
const BTN_OUTLINE_ON_GREEN = `${BTN} min-h-12 border border-white/35 px-5 text-[var(--cue-brand-ink)] hover:bg-white/10`;

const capabilities = [
  {
    title: "Know what's next",
    detail: "Rehearsals, performances and meetings from the program's calendar, in one list.",
  },
  {
    title: "Check in at the door",
    detail: "Scan the code on the rehearsal-room screen, or type the eight characters.",
  },
  {
    title: "One roster, one record",
    detail: "Directors, section leaders and students read the same attendance record.",
  },
];

const programs = [
  {
    name: "Band",
    detail: "RHS Mustang Bands",
    summary:
      "Attendance and event tools for RHS band members and directors — rehearsals, performances and games.",
    instagram: "https://www.instagram.com/rhsmustangbands/",
    attendance: true,
  },
  {
    name: "Orchestra",
    detail: "RHS Strings",
    summary:
      "Follow the RHS orchestra community and stay up to date with performances. Attendance tracking is coming.",
    instagram: "https://www.instagram.com/rhs.strings/",
    attendance: false,
  },
];

/** The arrow that marks every outbound action on this page. */
function Go() {
  return <ArrowUpRight aria-hidden="true" className="h-4 w-4" />;
}

export function WelcomeScreen() {
  const { dark, toggle } = useDark();

  return (
    <div className="min-h-full bg-[var(--cue-page)] text-[var(--cue-ink)]">
      {/* --- masthead: the school and the way in, and nothing else --- */}
      <header className="safe-t mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <img src="/logo.svg" alt="" width={36} height={36} className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
          <div className="min-w-0">
            {/* On a phone the name wraps rather than truncates: “Redmond High Sch…”
                is not a wordmark. There is room to truncate again from 640px up. */}
            <p className="type-wordmark text-[0.8125rem] leading-tight sm:truncate sm:text-sm">
              Redmond High School
            </p>
            {/* The strapline needs 142px; a 360px phone leaves 93. It is the one
                piece of the lockup worth losing on a small screen. */}
            <p className="type-meta mt-0.5 hidden truncate sm:block">Music &amp; Arts attendance</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <IconButton
            label={dark ? "Use light mode" : "Use dark mode"}
            onClick={toggle}
            icon={
              dark ? (
                <Sun aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Moon aria-hidden="true" className="h-4 w-4" />
              )
            }
          />
          <Link viewTransition to="/sign-in" className={BTN_PRIMARY}>
            Sign in
            <Go />
          </Link>
        </div>
      </header>

      <main>
        {/* --- the one green surface: the program's own colour, nothing on top of it --- */}
        <section className="relative isolate overflow-hidden border-b-2 border-[var(--cue-gold-on-brand)] bg-[var(--cue-brand-panel)] text-[var(--cue-brand-ink)]">
          {/* The program's motif — five staff lines with notation drifting along
              them. The page's single decorative element, and it is inherited from
              the product rather than invented for the marketing site. */}
          <StaffMotif className="text-[var(--cue-brand-ink)] opacity-[0.14]" />

          <div className="relative z-10 mx-auto grid max-w-6xl gap-12 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:py-24">
            <div className="self-center">
              <h1 className="text-[var(--cue-brand-ink)]">
                <Poster tone="stage" rule>
                  Attendance, events and check-in for RHS music and arts.
                </Poster>
              </h1>
              <p className="mt-6 max-w-lg text-[0.9375rem] leading-relaxed text-[var(--cue-brand-ink)]/80">
                Built for RHS students, directors and section leaders — from the first rehearsal to
                the last concert.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link viewTransition to="/sign-in" className={BTN_ON_GREEN}>
                  Sign in
                  <Go />
                </Link>
                <Link viewTransition to="/sign-up" className={BTN_OUTLINE_ON_GREEN}>
                  Create an account
                </Link>
              </div>

              <p className="mt-6 max-w-md border-l-2 border-[var(--cue-gold-on-brand)] pl-4 text-sm leading-relaxed text-[var(--cue-brand-ink)]/75">
                Already have a join code from your director? Create an account first, then use it to
                land on your program&rsquo;s roster.
              </p>
            </div>

            {/* The call sheet: an ordered list, because that is what it is. */}
            <div className="self-center lg:pl-2">
              {/* `.type-kicker` sets its own colour, and it lives outside Tailwind's
                  layers — so a plain utility cannot recolour it. The `!` is the
                  override, and gold is the only colour that clears 4.5:1 against
                  the dark green panel in *both* themes. */}
              <p className="type-kicker text-[var(--cue-gold-on-brand)]!">
                What a member does here
              </p>
              <ol className="mt-4 border-t border-white/20">
                {capabilities.map((item, index) => (
                  <li key={item.title} className="flex gap-4 border-b border-white/20 py-5">
                    <span
                      aria-hidden="true"
                      className="type-figure mt-0.5 w-7 shrink-0 text-lg text-[var(--cue-gold-on-brand)]"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-semibold">{item.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-[var(--cue-brand-ink)]/75">
                        {item.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* --- the programs --- */}
        <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 border-b border-[var(--cue-line)] pb-4">
            <div>
              <p className="type-kicker">Programs</p>
              <h2 className="type-title mt-2">RHS music programs</h2>
            </div>
            <p className="type-meta max-w-sm">
              Open the attendance app for band, or follow the program pages below.
            </p>
          </header>

          {/* Not two identical cards: band runs on the app, orchestra has a page to
              follow, and the layout says so — a tinted, ruled panel on the left,
              bare paper with a rule on the right. */}
          <div className="mt-10 grid gap-10 md:grid-cols-[1.15fr_0.85fr] md:gap-0">
            {programs.map((program) => (
              <article
                key={program.name}
                className={
                  program.attendance
                    ? "flex flex-col rounded-[var(--radius-panel)] border border-[var(--cue-line)] bg-[var(--cue-leaf-soft)] p-6 sm:p-7"
                    : "flex flex-col md:border-l md:border-[var(--cue-line)] md:pl-10"
                }
              >
                <p className="type-kicker">{program.attendance ? "Attendance app" : "Program page"}</p>
                <h3 className="type-poster-sm mt-3">{program.name}</h3>
                <p className="mt-1 text-sm font-semibold text-[var(--cue-muted)]">{program.detail}</p>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--cue-muted)]">
                  {program.summary}
                </p>

                <div className="mt-7 flex flex-wrap gap-2">
                  {program.attendance ? (
                    <Link viewTransition to="/sign-in" className={BTN_PRIMARY}>
                      Band sign in
                      <Go />
                    </Link>
                  ) : null}
                  <a
                    href={program.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Follow ${program.detail} on Instagram (opens in a new tab)`}
                    className={BTN_OUTLINE}
                  >
                    Follow on Instagram
                    <Go />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--cue-line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5 text-sm text-[var(--cue-muted)] sm:px-8">
          <span className="type-meta">Redmond High School · Music &amp; Arts</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <nav aria-label="Legal" className="flex items-center gap-5">
              <Link
                viewTransition
                to="/privacy"
                className="motion-press inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[var(--cue-ink)]"
              >
                Privacy Policy
              </Link>
              <Link
                viewTransition
                to="/terms"
                className="motion-press inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[var(--cue-ink)]"
              >
                Terms of Use
              </Link>
            </nav>
            <Link
              viewTransition
              to="/sign-up"
              /* Leaf, not action: `--cue-action` is a *surface* green, and as text
                 on the dark page it measures 2.4:1. Leaf reads on both pages. */
              className="motion-press inline-flex min-h-11 items-center gap-1.5 font-semibold text-[var(--cue-leaf)] underline decoration-[var(--cue-gold)] decoration-2 underline-offset-4"
            >
              Join your program
              <Go />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
