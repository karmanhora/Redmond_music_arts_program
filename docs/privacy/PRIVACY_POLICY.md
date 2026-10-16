# Privacy Policy (DRAFT)

> **DRAFT — for school/district and legal review. Not yet in effect.** Bracketed
> `[…]` items are placeholders. Hosting a privacy policy does **not** by itself
> establish legal compliance.

**Effective date:** [TO BE SET]
**Applies to:** the Redmond High School (RHS) Music & Arts Attendance Tracker
("the App"), operated by [DEVELOPER NAME] ("we", "us").

## 1. What the App is
The App helps approved RHS music and arts programs track attendance for
rehearsals and events. It is offered free of charge. We do not sell student
information, show targeted advertising, or build advertising profiles.

## 2. Who may use it
The App is intended for use by RHS staff and students in approved programs, at
the direction of school staff. It is not directed to children under 13. If a
program serving students under 13 is added, additional safeguards will be
required and this policy will be updated.

## 3. Information we collect
- **Account:** email address, and the name you or your director provide.
- **Membership:** which program(s) you belong to, your role, and (optional)
  section.
- **Attendance:** whether you were present/absent/late/excused for an event,
  check-in time, and any note a staff member adds.
- **Invitations:** when a staff member invites someone, their name and email are
  stored until the invitation is accepted or expires.
- **Calendar:** if staff connect a public Google Calendar feed, its iCal URL and
  imported event titles, dates, times, locations, and descriptions are stored
  for that program's schedule.
- **Technical:** limited records used to prevent abuse (for example, failed
  check-in counts), and standard server logs kept by our hosting providers.

We do **not** collect payment data, precise location, biometrics, or advertising
identifiers.

## 4. How we use it
Only to run attendance for your program: to show rosters, record check-ins, give
staff attendance summaries, and send service emails (such as sign-in
confirmation). Staff-connected calendar events are used to populate the
program schedule and set their default attendance type. The App reads only a
public calendar feed; it does not access a user's private Google Calendar or
Google account. We do not use information for advertising or for any purpose
unrelated to the program.

## 5. Who can see it
- **Students:** their own attendance, and their program's events.
- **Section leaders, secretaries, directors:** attendance within their own
  program, as their role allows.
- **Other programs:** cannot see your program's data. Access is enforced by the
  database itself, not by the screen you happen to be on.
- **Calendar source:** program members can see imported events; only staff with
  event-management permission can connect or replace the feed URL. A public
  Google feed can be read by anyone who has its URL, so staff should connect
  only a calendar approved for public sharing.
- **Service providers:** Supabase (database, authentication, email, and the
  calendar import function), Google (the public calendar feed), and Vercel
  (hosting) process the data on our behalf. See
  [`THIRD_PARTY_PROVIDERS.md`](THIRD_PARTY_PROVIDERS.md).
- **The school:** may be given access to its own program's records on request.

## 6. Where data is stored and how it is protected
Data is stored in Supabase. We use access controls (row-level security),
encryption in transit (TLS), and least-privilege roles to protect it. Provider
security details are described in
[`THIRD_PARTY_PROVIDERS.md`](THIRD_PARTY_PROVIDERS.md). No system is perfectly
secure.

## 7. Retention and deletion
We keep attendance records for the school's program as long as needed to run the
program and to satisfy the school's recordkeeping needs. A user may delete their
account in the App; this removes their identity and personal data but may leave a
**de-identified** attendance entry that the school needs for its records. Pending
invitations are deleted after [N] days. The full schedule is in
[`RETENTION_AND_DELETION.md`](RETENTION_AND_DELETION.md).

## 8. Legal basis and the school's role
If the App handles records for a public school, those records may be **education
records** under FERPA, and the school remains responsible for them. Our role is
limited to operating the App on the school's behalf under a written agreement.
Where Washington law (RCW 28A.604) applies, we act as a school service provider
with the duties that statute sets out. **[counsel]**

## 9. Your choices and rights
Parents/eligible students may inspect and request correction or deletion of
records held by the school through the district's normal records process
(LWSD Policy 3231). To make a request about the App itself, contact
[CONTACT EMAIL]. We will forward school-record requests to the district.

## 10. Security incidents
If we become aware of a breach involving personal information, we will notify the
school promptly so it can meet its notification duties, which in Washington
include notice within 30 days and to the Attorney General if more than 500
residents are affected. See
[`SECURITY_AND_INCIDENT_RESPONSE.md`](SECURITY_AND_INCIDENT_RESPONSE.md).

## 11. Changes
We will post material changes here and, where required, give prominent notice
before they take effect.

## 12. Contact
[DEVELOPER NAME] — [CONTACT EMAIL]. For school-record questions, contact the
school/district: [DISTRICT CONTACT].
