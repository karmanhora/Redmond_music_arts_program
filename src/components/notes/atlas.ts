/**
 * The note glyph atlas.
 *
 * Twelve notation marks are drawn once into an offscreen 2D canvas with plain
 * vector paths — no font, no network, nothing bundled but this file — and that
 * canvas becomes the source for both engines: the WebGPU engine uploads it as a
 * texture, and the Canvas2D fallback tints and blits it. Because both read the
 * same pixels, "looks the same" is structural rather than a promise.
 *
 * Each glyph is authored in a 100×100 box, y down, and centred in its cell with
 * transparent padding so linear filtering can never sample a neighbouring glyph.
 */

/** Order matters: the shader addresses glyphs by index, so append, never reorder. */
export const GLYPHS = [
  "quarter",
  "eighth",
  "beamedEighths",
  "sixteenthPair",
  "trebleClef",
  "bassClef",
  "quarterRest",
  "eighthRest",
  "halfNote",
  "sixteenthNote",
  "beamedSixteenths",
  "sixteenthRest",
] as const;

export type GlyphName = (typeof GLYPHS)[number];

/** Atlas geometry. `ATLAS_COLS`/`ATLAS_ROWS` are mirrored in notes.wgsl. */
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 3;
/** Cell size in atlas pixels; the glyph occupies `cell - 2 * pad`. */
export const ATLAS_CELL = 80;
const PAD = 8;
const BOX = 100;

export interface GlyphAtlas {
  /** The untinted source, white on transparent — its alpha is the coverage. */
  source: HTMLCanvasElement;
  width: number;
  height: number;
  cell: number;
}

const HEAD_RX = 15;
const HEAD_RY = 11;
const HEAD_TILT = (-20 * Math.PI) / 180;
const STEM = 4.5;

type Glyph = (ctx: CanvasRenderingContext2D) => void;

function head(ctx: CanvasRenderingContext2D, cx: number, cy: number, filled = true): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(HEAD_TILT);
  ctx.beginPath();
  ctx.ellipse(0, 0, HEAD_RX, HEAD_RY, 0, 0, Math.PI * 2);
  if (filled) {
    ctx.fill();
  } else {
    ctx.lineWidth = 5.5;
    ctx.stroke();
  }
  ctx.restore();
}

function stem(ctx: CanvasRenderingContext2D, cx: number, cy: number, top: number): number {
  const x = cx + HEAD_RX * 0.7;
  ctx.beginPath();
  ctx.rect(x, top, STEM, cy - top);
  ctx.fill();
  return x + STEM;
}

/** One note head with a stem, returning the stem's top-right corner. */
function stemmed(cx: number, cy: number, top: number): Glyph {
  return (ctx) => {
    head(ctx, cx, cy);
    stem(ctx, cx, cy, top);
  };
}

/** The little hook on an eighth note. */
function flag(ctx: CanvasRenderingContext2D, x: number, y: number, drop = 0): void {
  ctx.beginPath();
  ctx.moveTo(x, y + drop);
  ctx.quadraticCurveTo(x + 19, y + 12 + drop, x + 8, y + 33 + drop);
  ctx.quadraticCurveTo(x + 15, y + 15 + drop, x, y + 6 + drop);
  ctx.closePath();
  ctx.fill();
}

/** A beam joining stem tops. */
function beam(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness = 8.5
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2, y2 + thickness);
  ctx.lineTo(x1, y1 + thickness);
  ctx.closePath();
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

const glyphs: Record<GlyphName, Glyph> = {
  quarter: stemmed(38, 76, 18),

  eighth: (ctx) => {
    head(ctx, 38, 76);
    const x = stem(ctx, 38, 76, 18);
    flag(ctx, x, 18);
  },

  beamedEighths: (ctx) => {
    head(ctx, 26, 78);
    const a = stem(ctx, 26, 78, 20);
    head(ctx, 66, 72);
    const b = stem(ctx, 66, 72, 14);
    beam(ctx, a, 20, b, 14);
  },

  sixteenthPair: (ctx) => {
    head(ctx, 26, 78);
    const a = stem(ctx, 26, 78, 20);
    head(ctx, 66, 72);
    const b = stem(ctx, 66, 72, 14);
    beam(ctx, a, 20, b, 14);
    beam(ctx, a, 33, b, 27);
  },

  trebleClef: (ctx) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The two bowls of the G-clef, then the spine, then the tail ball.
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(52, 14);
    ctx.bezierCurveTo(30, 22, 32, 42, 46, 50);
    ctx.bezierCurveTo(63, 60, 64, 72, 51, 79);
    ctx.bezierCurveTo(38, 86, 25, 80, 28, 68);
    ctx.bezierCurveTo(31, 58, 45, 58, 51, 65);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(52, 14);
    ctx.lineTo(46, 86);
    ctx.stroke();
    dot(ctx, 46, 89, 4.5);
  },

  bassClef: (ctx) => {
    ctx.beginPath();
    ctx.moveTo(32, 22);
    ctx.bezierCurveTo(23, 36, 30, 48, 46, 53);
    ctx.bezierCurveTo(65, 58, 78, 63, 71, 75);
    ctx.bezierCurveTo(65, 86, 47, 88, 39, 78);
    ctx.bezierCurveTo(33, 70, 40, 61, 50, 61);
    ctx.closePath();
    ctx.fill();
    dot(ctx, 76, 39, 5.5);
    dot(ctx, 76, 53, 5.5);
  },

  quarterRest: (ctx) => {
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(44, 20);
    ctx.quadraticCurveTo(67, 38, 48, 52);
    ctx.quadraticCurveTo(29, 65, 56, 76);
    ctx.lineTo(48, 88);
    ctx.stroke();
  },

  eighthRest: (ctx) => {
    dot(ctx, 37, 30, 6);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(55, 21);
    ctx.lineTo(38, 58);
    ctx.stroke();
    dot(ctx, 38, 62, 5);
  },

  halfNote: (ctx) => {
    head(ctx, 38, 76, false);
    stem(ctx, 38, 76, 18);
  },

  sixteenthNote: (ctx) => {
    head(ctx, 38, 76);
    const x = stem(ctx, 38, 76, 18);
    flag(ctx, x, 18);
    flag(ctx, x, 30);
  },

  beamedSixteenths: (ctx) => {
    head(ctx, 18, 78);
    const a = stem(ctx, 18, 78, 22);
    head(ctx, 48, 74);
    stem(ctx, 48, 74, 18);
    head(ctx, 78, 70);
    const c = stem(ctx, 78, 70, 14);
    beam(ctx, a, 22, c, 14);
    beam(ctx, a, 35, c, 27);
  },

  sixteenthRest: (ctx) => {
    dot(ctx, 33, 27, 5);
    dot(ctx, 47, 22, 5);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(57, 21);
    ctx.lineTo(39, 58);
    ctx.stroke();
    dot(ctx, 39, 62, 5);
  },
};

/** Renders the atlas. Returns `null` when there is no 2D context to draw into. */
export function buildAtlas(): GlyphAtlas | null {
  const width = ATLAS_COLS * ATLAS_CELL;
  const height = ATLAS_ROWS * ATLAS_CELL;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const ctx = source.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  // White on transparent: the alpha channel is the coverage the shader samples.
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";

  const inner = ATLAS_CELL - PAD * 2;
  GLYPHS.forEach((name, index) => {
    const col = index % ATLAS_COLS;
    const row = Math.floor(index / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * ATLAS_CELL + PAD, row * ATLAS_CELL + PAD);
    ctx.scale(inner / BOX, inner / BOX);
    // Rests and clefs read better with a touch more weight at small sizes.
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    glyphs[name](ctx);
    ctx.restore();
  });

  return { source, width, height, cell: ATLAS_CELL };
}

/**
 * A copy of the atlas tinted one flat colour by `source-in` compositing. The
 * Canvas2D engine keeps one per palette entry so a note is a single `drawImage`.
 */
export function tintAtlas(atlas: GlyphAtlas, color: string): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(atlas.source, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, atlas.width, atlas.height);
  return canvas;
}
