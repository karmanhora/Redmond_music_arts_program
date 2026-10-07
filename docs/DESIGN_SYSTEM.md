# Cue Desk design system

## Direction

Cue Desk treats the app as a rehearsal-room operations tool: event first, status
clearly labeled, and controls large enough to use between cues. Layouts use
asymmetric editorial/operational hierarchy instead of repeated icon-card grids.
The landing page uses a labeled example roster, not a claim that sample
attendance is live.

## Color

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--cue-page` | `#FAF9F4` | `#111713` | Main page background |
| `--cue-panel` | `#FFFFFF` | `#1B231D` | Main panels and cards |
| `--cue-raised` | `#F1F0E9` | `#242E27` | Form groups, secondary surfaces |
| `--cue-ink` | `#20241F` | `#F4F2E9` | Primary text |
| `--cue-muted` | `#575E57` | `#B7C0B8` | Supporting text |
| `--cue-border` | `#D8D9D0` | `#39443B` | Rules and control boundaries |
| `--cue-green` | `#214D35` | `#79AA82` | Primary action, on-time status |
| `--cue-gold` | `#D5A33A` | `#E5B64F` | RHS heritage accent, attention |
| `--cue-late` | `#A74432` | `#F08B73` | Late/error status; always label it |
| `--cue-focus` | `#79520A` | `#F2C761` | Keyboard focus indicator |

Dark surfaces, borders, and text are chosen independently rather than produced
by inverting the light theme. Program-level colors continue to use the existing
`band-*` semantic variables and `applyThemeTokens`; these names are retained to
avoid changing the many existing utility classes or per-program theming.

## Typography

- **Display:** Barlow Condensed, locally bundled Latin subset, weights 600 and
  700. Use `font-display` for event names, section labels, and large counts.
- **Text/UI:** IBM Plex Sans Variable, locally bundled with Unicode subsets.
  Use the `font-sans` default for body text, forms, and roster names.
- Keep body copy comfortably readable; reserve condensed uppercase text for
  short labels and headings, never long instructions or paragraphs.

The font packages are bundled by Vite. No font stylesheet or font file is
requested from a third-party host at runtime.

## Polish references

- **Flighty:** borrow compact status labels, high-visibility countdowns, and a
  clear distinction between current and upcoming states.
- **Strava:** borrow progress that feels tied to a real personal effort, not a
  decorative dashboard percentage.
- **Apple Sports:** borrow the live counter's strong numerals and the way a
  changing score remains readable at a glance.
- **Mandalora Studios** (studiosmandalora.github.io/web): borrow motion
  structure only — masked line reveals for display headings, left-to-right rule
  draws, arrow nudges, and a slow status breathe, all at app-length durations.
  No branding, gradients, glows, custom cursor, or scroll-linked effects are
  borrowed.

These are references for hierarchy and feedback, not assets or copied layouts.

## Shape, spacing, and elevation

- `--radius-control: 10px`: buttons, inputs, compact status surfaces.
- `--radius-panel: 14px`: major panels. Do not round every nested group.
- `--radius-sheet: 18px`: bottom sheets only.
- Prefer Tailwind's 4px spacing scale. Keep 16px minimum page gutters on phones;
  use 24px at larger widths.
- `--elevation-panel` is a quiet 2px lift in light mode and a restrained shadow
  in dark mode. Borders and hierarchy do most of the work.
- Primary touch controls are at least 44px tall. Icon-only controls use an
  accessible name and a 44px square target.

## Shared components

- Use `Button` for actions (`primary`, `secondary`, `accent`, `ghost`, `danger`).
  `loading` communicates an in-flight action; it does not delay the action.
- Use `Card` for a single content group. Prefer a rule or status edge to nesting
  multiple cards.
- Use `Field`, `Input`, `Select`, and `Textarea` so labels, focus, and contrast
  remain consistent.
- Use `Alert` for recoverable errors and explicit status messages. Never rely on
  color alone.
- Use `Skeleton` for loading layouts, `EmptyState` for empty data with a next
  action, and `ProgressRing` with a text value for percentages.
- Use `Sheet` for focused mobile tasks. It supports Escape, focus containment,
  focus restoration, and touch drag dismissal.

## Accessibility

- Visible keyboard focus is required. Keep keyboard operation and semantic
  labels when changing visuals.
- Status colors must be accompanied by text or an icon with an accessible name.
- Avoid truncating essential roster names; long names may wrap in dense views.
- The `prefers-reduced-motion` media query removes movement without removing
  any state change or interaction.

## Avoid

No gradients, glow effects, glass panels, emoji/stock illustrations, scattered
music glyphs, filler welcome copy, or repeated generic feature tiles. The
landing page may use one deliberate, low-contrast staff-and-notes motif, kept
clear of the headline and supporting copy. The rehearsal identity comes from the
names, schedule, live count, and condensed instrument-board typography.
