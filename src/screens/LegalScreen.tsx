import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Alert } from "../components/ui";
import { APP_NAME, ORG_NAME } from "../lib/constants";

/**
 * The public legal pages: `/privacy` and `/terms`.
 *
 * These are the in-app, self-contained renderings of the drafts in
 * `docs/privacy/PRIVACY_POLICY.md` and `docs/privacy/TERMS_OF_USE.md`, so a
 * student, parent, or district reviewer can read them without a GitHub account.
 *
 * Two rules for this file:
 *  1. Every page must stay reachable **signed out** — a privacy policy the
 *     public cannot open is not a notice. The routes are registered in App.tsx
 *     for the signed-out tree as well.
 *  2. Nothing here may claim compliance or fill in a placeholder with a guess.
 *     Unfilled items stay visible as `[BRACKETED]` placeholders and the draft
 *     banner stays until the district approves the final text.
 */

type LegalPage = "privacy" | "terms";

interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalDoc {
  title: string;
  kicker: string;
  updated: string;
  banner: string;
  sections: LegalSection[];
}

const CONTACT_EMAIL = "[CONTACT EMAIL]";

const PRIVACY: LegalDoc = {
  title: "Privacy Policy",
  kicker: "Privacy",
  updated: "Effective date: [TO BE SET]",
  banner:
    "This is a draft for school/district and legal review. It is not yet in effect and " +
    "publishing it does not by itself make the app compliant.",
  sections: [
    {
      heading: "1. What this app is",
      paragraphs: [
        `The ${APP_NAME} ("the App") helps approved Redmond High School (RHS) music and arts programs track attendance for rehearsals and events. It is offered free of charge.`,
        "We do not sell student information, show targeted advertising, or build advertising profiles. We do not use student information for any purpose unrelated to running the program.",
      ],
    },
    {
      heading: "2. Who may use it",
      paragraphs: [
        "The App is intended for use by RHS staff and students in approved programs, at the direction of school staff. It is not directed to children under 13.",
        "If a program serving students under 13 is added, additional safeguards will be required and this policy will be updated.",
      ],
    },
    {
      heading: "3. Information we collect",
      bullets: [
        "Account: your email address, and the name you or your director provide.",
        "Membership: which program(s) you belong to, your role, and (optional) section.",
        "Attendance: whether you were present, absent, late, or excused for an event, the check-in time, and any note a staff member adds.",
        "Invitations: when staff invite someone, that person's name and email are stored until the invitation is accepted or expires.",
        "Technical: limited records used to prevent abuse (for example, failed check-in counts) and standard server logs kept by our hosting providers.",
      ],
      paragraphs: [
        "We do not collect payment data, precise location, biometrics, or advertising identifiers.",
      ],
    },
    {
      heading: "4. How we use it",
      paragraphs: [
        "Only to run attendance for your program: to show rosters, record check-ins, give staff attendance summaries, and send service emails such as sign-in confirmation. We do not use it for advertising or for any purpose unrelated to the program.",
      ],
    },
    {
      heading: "5. Who can see it",
      bullets: [
        "Students: their own attendance, and their program's events.",
        "Section leaders, secretaries, and directors: attendance within their own program, as their role allows.",
        "Other programs: cannot see your program's data. Access is enforced by the database itself, not by the screen you happen to be on.",
        "Service providers: Supabase (database, authentication, email) and Vercel (hosting) process data on our behalf as described in our third-party provider list.",
        "The school: may be given access to its own program's records on request.",
      ],
    },
    {
      heading: "6. Where data is stored and how it is protected",
      paragraphs: [
        "Data is stored in Supabase. We use access controls (row-level security), encryption in transit (TLS), and least-privilege roles to protect it. No system is perfectly secure.",
      ],
    },
    {
      heading: "7. Retention and deletion",
      paragraphs: [
        "We keep attendance records for the school's program as long as needed to run the program and to satisfy the school's recordkeeping needs.",
        "You may delete your account in the App. This removes your identity and personal data, but may leave a de-identified attendance entry that the school needs for its records. Pending invitations are deleted after [N] days.",
      ],
    },
    {
      heading: "8. The school's role",
      paragraphs: [
        "If the App handles records for a public school, those records may be education records under FERPA, and the school remains responsible for them. Our role is limited to operating the App on the school's behalf under a written agreement.",
        "Where Washington law (RCW 28A.604) applies, we act as a school service provider with the duties that statute sets out. [counsel]",
      ],
    },
    {
      heading: "9. Your choices and rights",
      paragraphs: [
        `Parents and eligible students may inspect and request correction or deletion of records held by the school through the district's normal records process (LWSD Policy 3231). To make a request about the App itself, contact ${CONTACT_EMAIL}. We will forward school-record requests to the district.`,
      ],
    },
    {
      heading: "10. Security incidents",
      paragraphs: [
        "If we become aware of a breach involving personal information, we will notify the school promptly so it can meet its notification duties. In Washington these include notice within 30 days, and notice to the Attorney General if more than 500 residents are affected.",
      ],
    },
    {
      heading: "11. Changes",
      paragraphs: [
        "We will post material changes here and, where required, give prominent notice before they take effect.",
      ],
    },
    /*
     * TODO(add-back) — "12. Contact" was intentionally removed from the published
     * policy. Re-add this section once a real developer name and district contact
     * exist (see docs/privacy/WEBSITE_LEGAL_CHANGES.md §4):
     *
     *   {
     *     heading: "12. Contact",
     *     paragraphs: [
     *       `[DEVELOPER NAME] — ${CONTACT_EMAIL}. For school-record questions, contact the school/district: [DISTRICT CONTACT].`,
     *     ],
     *   },
     *
     * Until then the policy deliberately has no contact section.
     */
  ],
};

const TERMS: LegalDoc = {
  title: "Terms of Use",
  kicker: "Terms",
  updated: "Effective date: [TO BE SET]",
  banner:
    "This is a draft for school/district and legal review. It is not yet in effect and " +
    "is not legal advice. If the school adopts its own terms, those govern.",
  sections: [
    {
      heading: "1. What this is",
      paragraphs: [
        `The ${APP_NAME} ("the App") is a free tool for approved RHS music and arts programs. It is provided as-is, without warranty of any kind.`,
      ],
    },
    {
      heading: "2. Who may use it",
      paragraphs: [
        "Staff and students in approved programs, at school direction. Accounts may be created only for the program's legitimate use.",
      ],
    },
    {
      heading: "3. Your responsibilities",
      paragraphs: [
        "Use the App only for its attendance purpose. Do not attempt to access another program's data, share QR codes or check-in codes with people outside the program, or upload unlawful content.",
      ],
    },
    {
      heading: "4. No warranty / limited liability",
      paragraphs: [
        "The App is offered free of charge and may be unavailable or contain errors. To the extent permitted by law, the operator is not liable for indirect or consequential loss arising from use of the App.",
        "This clause must be reviewed by a parent or guardian if the operator is a minor, and by district counsel before the school relies on it. It does not and cannot waive the district's or any individual's legal obligations.",
      ],
    },
    {
      heading: "5. Privacy",
      paragraphs: ["See our Privacy Policy for how information is collected and used."],
    },
    {
      heading: "6. Ownership",
      paragraphs: [
        "The software is owned by the developer. Student information entered into the App belongs to the school and students, not to the developer.",
      ],
    },
    {
      heading: "7. Termination",
      paragraphs: [
        "The school may stop using the App at any time; the developer may suspend a program for misuse.",
      ],
    },
    {
      heading: "8. School agreement",
      paragraphs: [
        "If a school agreement is executed, it takes precedence over these terms for the school's use.",
      ],
    },
  ],
};

/** Public legal pages — readable without signing in. */
export function LegalScreen({ page }: { page: LegalPage }) {
  const doc = page === "privacy" ? PRIVACY : TERMS;
  const other = page === "privacy" ? { to: "/terms", label: "Terms of Use" } : { to: "/privacy", label: "Privacy Policy" };

  return (
    <div className="min-h-full overflow-x-hidden bg-[var(--cue-page)] text-[var(--cue-ink)]">
      <header className="safe-t mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          viewTransition
          to="/"
          className="motion-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-[var(--cue-muted)] hover:text-[var(--cue-ink)]"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to the app
        </Link>
        <span className="truncate text-[10px] font-bold tracking-[0.2em] text-[var(--cue-muted)] uppercase">
          {ORG_NAME}
        </span>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <p className="font-display text-sm font-bold tracking-[0.18em] text-[var(--cue-green)] uppercase">
          {doc.kicker}
        </p>
        <h1 className="mt-2 font-display text-4xl leading-none font-bold uppercase tracking-[-0.03em] sm:text-5xl">
          {doc.title}
        </h1>
        <p className="mt-3 text-sm text-[var(--cue-muted)]">{doc.updated}</p>

        <div className="mt-5">
          <Alert tone="warn">{doc.banner}</Alert>
        </div>

        <div className="mt-8 space-y-7">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-xl font-bold tracking-wide">{section.heading}</h2>
              {section.paragraphs?.map((text) => (
                <p key={text} className="mt-2 text-sm leading-relaxed text-[var(--cue-muted)]">
                  {text}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--cue-muted)]">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-[var(--cue-border)] pt-5 text-sm">
          <Link
            viewTransition
            to={other.to}
            className="font-semibold text-[var(--cue-action)] underline decoration-[var(--cue-gold)] decoration-2 underline-offset-4"
          >
            Read the {other.label}
          </Link>
        </div>
      </main>
    </div>
  );
}
