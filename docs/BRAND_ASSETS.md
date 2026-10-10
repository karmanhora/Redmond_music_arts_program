# Brand assets

Everything the app uses as its own face — the favicon, the home-screen icon, the
splash mark and the sign-in header mark. One vector file is the source; the PNGs
are rendered from it.

## What is in here

| File | Size | Format | Where it is used |
| --- | --- | --- | --- |
| [`public/logo.svg`](../public/logo.svg) | 1.3 KB | SVG, square 512×512 | The mark. `index.html` favicon, [`Splash`](../src/components/Splash.tsx), [`ConfigMissingScreen`](../src/screens/ConfigMissingScreen.tsx), and the standalone headers of [`JoinProgramScreen`](../src/screens/JoinProgramScreen.tsx) / [`NewProgramScreen`](../src/screens/NewProgramScreen.tsx) |
| `public/icon-192.png` | 192×192 | PNG, transparent | `manifest.webmanifest`, `purpose: "any"` |
| `public/icon-512.png` | 512×512 | PNG, transparent | `manifest.webmanifest`, `purpose: "any"` |
| `public/icon-maskable-192.png` | 192×192 | PNG, opaque, full bleed | `manifest.webmanifest`, `purpose: "maskable"` (Android adapts this to its own shape) |
| `public/icon-maskable-512.png` | 512×512 | PNG, opaque, full bleed | Same, for high-density launchers |
| `public/apple-touch-icon.png` | 180×180 | PNG, opaque, full bleed | iOS home screen; iOS applies the corner mask itself |

All of them are derivative. **Change the mark in `public/logo.svg` and re-render**;
never hand-edit a PNG.

## The current mark is a placeholder

On 2026-10-09 the previous artwork was removed on request. It was the school's own
logo, and it was stored the expensive way: a ~200 KB SVG whose "drawing" was a
base64 PNG bitmap, one file per colour scheme, plus five raster icons cut from it.
Replacing a colour meant re-exporting all of it.

What replaced it is a **deliberate, original stand-in**: a deep-green rounded
badge with a cream quaver and a gold flag. It is ours, it carries no third-party
or school artwork, and it is a *placeholder* — a real Music & Arts mark is
expected to replace it.

A brief for whoever draws that mark, learned from where this one has to survive:

- **It must read at 16 px.** That is the favicon. A quaver survives; a six-element
  composition does not.
- **It must work on `#214d35`.** The splash screen and the sign-in header are that
  green, so a mark in the brand green disappears there. The badge is `#173b28`
  (the deep green, also available as `bg-band-deep`) for exactly that reason.
- **The glyph must sit inside the middle 80%.** Android crops maskable icons to a
  circle, squircle or rounded square of its choosing; anything outside the safe
  zone is at risk. The render script scales the glyph to 72% to keep it clear.
- **Square, and no text.** A wordmark is unreadable at icon size, and square is
  what every platform assumes.
- **Vector, not raster.** No `<image>` or base64 payloads inside the SVG.

## Replacing it

```bash
# 1. Put the new artwork at public/logo.svg (square, full-bleed badge).
# 2. Re-render every icon from it.
node scripts/brand/render-icons.mjs

# 3. Confirm the build carries them.
npm run build && ls -la dist/logo.svg dist/*.png
```

[`scripts/brand/render-icons.mjs`](../scripts/brand/render-icons.mjs) renders with a
headless Chrome or Edge (it finds the usual install paths, or set `CHROME_PATH`),
so there is no npm dependency — no `sharp`, no `resvg`, no ImageMagick. It lays
every target out in a 512×512 viewport and scales it down with
`--force-device-scale-factor`, because headless Chrome silently *clamps* small
`--window-size` values and would otherwise screenshot the wrong region of the
page.

The script fails loudly rather than shipping a wrong icon. It asserts that every
PNG really is the size it asked for (decoding the IHDR header), and that the
`logo.svg` it is editing still has the two things it substitutes: the badge's
`rx="112"` corner and the `#mark` transform. **If the new artwork is not a
rounded badge, update `BADGE_RADIUS` / `svgFor()` at the top of that script** —
that is the only code that knows the mark's shape, and it will tell you.

## Provenance and permission

The removed artwork was the school's, and shipping it in a public build needed
permission that nobody had recorded. Whatever replaces the placeholder is the same
question: the school should confirm it may be published, and if the new file is a
photo, scan or raster trace of the real logo, keep it out of the SVG and add it as
a PNG asset instead so the vector stays small.

There is no third-party or stock artwork in this directory, and nothing here is
generated from a commercial brand kit.
