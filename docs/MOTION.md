# Motion system

Motion gives immediate feedback to a rehearsal action; it is not decoration.
Only `transform` and `opacity` are animated. Actions are never delayed until an
animation finishes.

## Tokens

| Token | Value | Intended use |
| --- | --- | --- |
| `--motion-short` | `110ms` | Press feedback and quick route exit |
| `--motion-base` | `180ms` | Check-in mark, roster arrival, route entry |
| `--motion-long` | `260ms` | Sheet entrance and ring arrival |
| `--motion-tempo` | `80ms` | Shared interval if a short sequence needs staggering |
| `--ease-standard` | `cubic-bezier(0.2, 0.75, 0.25, 1)` | Ordinary state changes |
| `--spring-snappy` | `cubic-bezier(0.2, 1.12, 0.35, 1)` | Small count/mark response |
| `--spring-settle` | `cubic-bezier(0.22, 1, 0.36, 1)` | Arrival and completion |
| `--spring-gentle` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Sheet arrival |

Timed loops are limited to the low-contrast skeleton sheen, the landing
page's restrained music watermark, and the live view's slow opacity breathe on
the "live" dot — one loop, opacity only, and the word "live" never depends on
it. If a sequence adds staggered items, derive all intervals from
`--motion-tempo`; do not add independent timings.

The public landing hero uses one short, entrance-only reveal, with each text
group staggered by `--motion-tempo`. Its restrained staff-and-notes watermark
drifts slowly behind the event preview; it never sits behind the headline or
body copy. Both effects are removed for reduced-motion preferences.

## Moments

- **Press:** `motion-press` scales to 0.985 while held. Input is not blocked.
- **Route:** Links that opt into React Router's View Transitions API use a short
  directional root transition. Browsers without the API navigate immediately
  with no dependency or custom animation fallback.
- **Navigation:** The active bottom-tab underline uses one shared element name,
  so it moves between tabs during supported View Transitions. It remains a
  static active-state underline when the API is unavailable.
- **Staged entrance:** one shared ladder reveals a screen's top-level groups
  once, stepped by `--motion-tempo`, and nothing is hidden behind it. The
  student home leads with its header and hero event; the check-in screen lands
  the program header, then the form, then the Today hint; the staff check-in
  screen lands the mode control, then the event picker, then the live view; the
  auth screen lands its audience picker, then the copy, then the form — and the
  copy re-reveals when the student/teacher choice changes, keyed so the Clerk
  form underneath never remounts.
- **Segmented control:** the active pill settles between tabs with opacity and
  a small scale instead of a background swap — no layout movement. Each tab
  owns its own pill, so option rows that wrap stay aligned, and keyboard focus
  stays on the tab being pressed.
- **Check-in form:** switching Scan QR / Enter code swaps a pane keyed to the
  tab, which arrives from the side of the choice that was picked in one
  `--motion-base` beat. The code-entry meter under the input fills with
  `scaleX` as characters land — a transform, so typing never reflows the form;
  the hint and the disabled button stay the authoritative signals.
- **Display lines:** headings that carry a moment — the check-in title, both
  confirmation headings, and the projector's event name — reveal from behind a
  static mask: the text slides up inside an `overflow` clip, so only `transform`
  moves. One settle per line, never letter-by-letter.
- **Drawn rule:** a short accent rule draws itself left to right beneath those
  headings, one tempo step behind the line — green on time, gold when late.
- **Arrow nudge:** an icon that promises a direction — the event picker's
  chevron — moves 4px toward it on hover or press.
- **Check-in:** the confirmation wash resolves in 640ms, under the 700ms target;
  the check mark scales in separately. On-time uses green; late uses gold and
  explicit late text; refusal/error uses the error treatment and a distinct
  optional haptic pattern.
- **Live view:** starting a check-in lands the code panel first and the roster
  column second. The code panel is keyed to the session token, so a refreshed
  code re-arrives as an arrival rather than swapping pixels silently. The
  checked-in meter grows with `scaleX` instead of a width change, and both the
  checked-in and the missing count roll into place. The status dot breathes
  slowly while the roster polls.
- **Live roster:** a newly keyed check-in row arrives with a short upward move;
  the changed live count rolls into place. The waiting-for-the-first-scan label
  settles once into "live", and "Everyone's here" settles in when the last
  section empties. Polling and check-in remain usable throughout.
- **Attendance ring:** the ring settles in on first display; the numeric
  percentage remains visible and authoritative.
- **Sheet:** the panel settles upward. On touch, a downward drag dismisses it
  after 120px or a quick downward release; otherwise it snaps back. Escape and
  the close button remain available.
- **Skeleton:** a slow, subtle sheen uses a single transform-only sweep.
- **Landing hero:** headline and preview arrive once with opacity and a small
  vertical transform. The score watermark uses a slow transform/opacity drift
  as a music-specific accent, not as a repeating page-wide effect.

## Reference note

The reveal structure — masked title lines, left-to-right rule draws, arrow
nudges, a slow status breathe, and a `scaleX` progress fill — follows the
Mandalora Studios reference site (studiosmandalora.github.io/web). Only the
technique is borrowed: durations and travel are cut to app tempo (a 520ms
reveal from a 125% start against the reference's ~1.15s reveals), and its
branding, gradients, glows, custom cursor, and scroll-linked effects are not
used.

## Reduced motion and haptics

`prefers-reduced-motion: reduce` disables movement and transitions globally;
staggered groups mount immediately, because their delays are cleared along with
the animation, and all controls and state changes still work. Haptics use the
browser's optional `navigator.vibrate` API and are a no-op when unavailable.
They are feedback, never the only signal that an action succeeded or failed.

## Budget and validation

No animation library is added. CSS cubic-bezier presets and a small
`navigator.vibrate` guard cover the implemented needs without a runtime motion
dependency. QR scanning remains dynamically imported by `QrScanner`; screen
routes are lazy-loaded. Device frame pacing, haptic behavior, and the 60fps
target still require physical-device recording and review.
