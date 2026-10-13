/**
 * The note palette.
 *
 * Notes are painted from the app's own CSS variables — never a literal colour —
 * so the landing page cannot drift from the rest of the product, and the dark
 * theme repaints them for free. The only adjustment made here is a floor on how
 * far a note can sit from the page it is drawn on: two of the five variables
 * (`--cue-mint`, `--cue-stage-ink`) are near-white tints that would vanish on
 * the cream page and near-black ones that would vanish on the dark one. Those
 * are mixed toward the theme's ink until they clear a visible-contrast floor.
 */

export interface NoteColor {
  r: number;
  g: number;
  b: number;
}

/** The five palette slots, in the order the shader indexes them. */
const VAR_NAMES = [
  "--cue-gold",
  "--cue-gold-on-brand",
  "--cue-leaf",
  "--cue-mint",
  "--cue-stage-ink",
] as const;

/** Slot 0 is weighted heaviest, so the field reads as the program's gold. */
const WEIGHTS = [0.34, 0.18, 0.28, 0.12, 0.08];

/** Notes are decoration: they only need to be clearly *there*. */
const MIN_CONTRAST = 1.75;

function parse(value: string): NoteColor | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    const expand = hex.length === 3 || hex.length === 4;
    const digits = expand
      ? hex
          .split("")
          .map((d) => d + d)
          .join("")
      : hex;
    if (digits.length !== 6 && digits.length !== 8) return null;
    const r = Number.parseInt(digits.slice(0, 2), 16);
    const g = Number.parseInt(digits.slice(2, 4), 16);
    const b = Number.parseInt(digits.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!match || !match[1]) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => Number.parseFloat(p));
  if (r === undefined || g === undefined || b === undefined) return null;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function luminance(color: NoteColor): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(a: NoteColor, b: NoteColor): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(from: NoteColor, to: NoteColor, amount: number): NoteColor {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

/**
 * Nudges `color` toward `ink` until it clears `MIN_CONTRAST` against `page`.
 * Capped at 70% so a passing palette entry is never re-tinted.
 */
function ensureVisible(color: NoteColor, page: NoteColor, ink: NoteColor): NoteColor {
  let result = color;
  for (let step = 1; step <= 7; step += 1) {
    if (contrast(result, page) >= MIN_CONTRAST) return result;
    result = mix(color, ink, step * 0.1);
  }
  return result;
}

/**
 * Reads the palette from live custom properties. Call it at start and again
 * whenever the theme flips — the values are resolved, not referenced.
 */
export function readPalette(element: Element): NoteColor[] {
  const styles = getComputedStyle(element);
  const page = parse(styles.getPropertyValue("--cue-page")) ?? { r: 247, g: 245, b: 238 };
  const ink = parse(styles.getPropertyValue("--cue-ink")) ?? { r: 22, g: 26, b: 22 };
  return VAR_NAMES.map((name) => {
    const raw = parse(styles.getPropertyValue(name));
    return ensureVisible(raw ?? ink, page, ink);
  });
}

/**
 * The staff ribbons' colour: the theme's ink, always well clear of the page.
 * Not a note colour, so it is kept out of the indexed palette above.
 */
export function readStaffColor(element: Element): NoteColor {
  const raw = getComputedStyle(element).getPropertyValue("--cue-ink");
  return parse(raw) ?? { r: 22, g: 26, b: 22 };
}

/** `rgb(...)`, for the Canvas2D engine's tinted atlas copies. */
export function toCss(color: NoteColor): string {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

/** Floats in 0..1, for the shader's `palette.colors` uniform. */
export function toUnits(color: NoteColor): [number, number, number, number] {
  return [color.r / 255, color.g / 255, color.b / 255, 1];
}

/** Picks a slot index, weighted toward gold. */
export function pickColorIndex(random: () => number): number {
  let roll = random();
  for (let i = 0; i < WEIGHTS.length; i += 1) {
    roll -= WEIGHTS[i] ?? 0;
    if (roll <= 0) return i;
  }
  return 0;
}
