/**
 * The note field: everything both engines must agree on.
 *
 * The WebGPU engine animates in the vertex shader; the Canvas2D fallback steps
 * every note on the CPU. To keep the two looking like one effect, the motion
 * arithmetic lives here once, and `notes.wgsl` mirrors it — same stream, same
 * sine ripple, same pointer push, same parallax, same calm pockets. Change
 * either side and change the other.
 *
 * Positions are in "unit space": x and y in 0..1 across the viewport, y up. It
 * is exactly square in pixels — one unit of x is the same number of pixels as
 * one unit of y — because world x is `unit.x * aspect` and the GPU divides it
 * back out. That is what lets a scale and a rotation mean the same thing in
 * both engines.
 */
import { GLYPHS } from "./atlas";
import { pickColorIndex } from "./palette";
import type { NoteColor } from "./palette";

export const GLYPH_COUNT = GLYPHS.length;

/** Burst pool. Mirrors BURST_PER / BURST_TOTAL in notes.wgsl. */
export const BURST_SLOTS = 4;
export const BURST_PER = 18;
export const BURST_TOTAL = BURST_SLOTS * BURST_PER;
export const BURST_LIFE = 1.4;

const TAU = Math.PI * 2;
/**
 * How much of a note survives inside a readable pocket. `0.2` looked calm on
 * paper and wrong on screen: measured against the page, a fifth of a
 * near-white glyph on cream still moved pixels by up to 70/255 in the pocket
 * over "RHS music programs". At 0.06 the field is legible as texture and
 * silent as competition — see docs/QA_REPORT.md (QA-01).
 */
export const CALM_ALPHA = 0.06;
/** How much of its size a note keeps inside a pocket — shrinking it helps more
 *  than fading it, because overlapping glyphs stop saturating each other. */
export const CALM_SCALE = 0.6;
/** Smallest quality factor the frame-time monitor will step down to. */
const MIN_QUALITY = 0.35;
const SLOW_FRAME_MS = 20;
const SLOW_WINDOW_S = 2;

/** A readable pocket of the page, in normalised screen space, top-left origin. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One drifting note. Twelve floats, packed verbatim into the instance buffer. */
export interface NoteInstance {
  baseX: number;
  baseY: number;
  velX: number;
  velY: number;
  rotation: number;
  spin: number;
  half: number;
  depth: number;
  glyph: number;
  color: number;
  phase: number;
  opacity: number;
}

/** One burst particle: fired from a click, gone in `BURST_LIFE` seconds. */
export interface BurstParticle {
  dirX: number;
  dirY: number;
  reach: number;
  rotation: number;
  spin: number;
  half: number;
  depth: number;
  glyph: number;
  color: number;
  phase: number;
  opacity: number;
}

/** A live burst origin, or an inactive slot. */
export interface BurstSlot {
  x: number;
  y: number;
  start: number;
  active: number;
}

export interface FrameState {
  time: number;
  aspect: number;
  /** Unit-space pointer. Only meaningful while `pointerActive` is 1. */
  pointerX: number;
  pointerY: number;
  pointerActive: number;
  /** Normalised scroll progress, -1..1. */
  scroll: number;
  calm: readonly Rect[];
}

/** What a note resolves to for one frame. Mirrors one `vs_main` invocation. */
export interface Sample {
  x: number;
  y: number;
  angle: number;
  half: number;
  alpha: number;
  glyph: number;
  color: number;
}

/**
 * The contract both engines implement. `burst` and `setCalm` are additions to
 * the minimal start/stop/resize/pointer/scroll/destroy set: a click burst and a
 * DOM-derived calm zone are required behaviours, and neither can be inferred
 * from the six.
 */
export interface NotesEngine {
  /** Begin animating. Safe to call once, after construction. */
  start(): void;
  /** Freeze the current frame without releasing anything. */
  stop(): void;
  /** Re-read the canvas box and rebuild the field to fit. */
  resize(): void;
  /** Pointer position in normalised screen space (y down), or `null` when gone. */
  setPointer(x: number | null, y: number | null): void;
  /** `scrollY` in pixels. Nudges the flow a little so the page feels continuous. */
  setScroll(scrollY: number): void;
  /** Replace the readable pockets that keep the field calm behind text. */
  setCalm(rects: readonly Rect[]): void;
  /** Release `BURST_PER` notes from a point in normalised screen space. */
  burst(x: number, y: number): void;
  /** Release every GPU resource, listener and timer. Terminal. */
  destroy(): void;
}

export interface EngineContext {
  readonly canvas: HTMLCanvasElement;
  /**
   * The five indexed note colours, resolved from the theme's custom properties.
   * Mutable because the host fills them in once the lazy module has loaded.
   */
  colors: NoteColor[];
  /** The staff ribbons' colour, resolved from `--cue-ink`. */
  staff: NoteColor;
  readonly reduced: boolean;
  /** Called when the GPU engine cannot continue and the fallback should take over. */
  readonly onFallback: (reason: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                   */
/* -------------------------------------------------------------------------- */

/** Small, fast, seedable PRNG — the same seed gives the same field. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Spawning                                                                   */
/* -------------------------------------------------------------------------- */

const GLYPH_WEIGHTS = [
  0.16, 0.14, 0.12, 0.09, 0.06, 0.05, 0.08, 0.07, 0.09, 0.05, 0.06, 0.03,
];

function pickGlyph(random: () => number): number {
  let roll = random();
  for (let i = 0; i < GLYPH_WEIGHTS.length; i += 1) {
    roll -= GLYPH_WEIGHTS[i] ?? 0;
    if (roll <= 0) return i;
  }
  return 0;
}

function insideAny(rects: readonly Rect[], x: number, y: number): boolean {
  return rects.some(
    (rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * Spreads `count` notes over the viewport along a lower-left → upper-right
 * stream, with a minority of slower counter-streams, and keeps clear of the
 * readable pockets so those areas start sparse rather than merely faded.
 */
export function createAmbient(
  count: number,
  random: () => number,
  calm: readonly Rect[]
): NoteInstance[] {
  const notes: NoteInstance[] = [];
  for (let i = 0; i < count; i += 1) {
    let screenX = random();
    let screenY = random();
    for (let attempt = 0; attempt < 10 && insideAny(calm, screenX, screenY); attempt += 1) {
      screenX = random();
      screenY = random();
    }

    const depth = random();
    // 85% ride the main stream, 15% run slowly against it for variety.
    const counter = random() < 0.15;
    const angle = (counter ? Math.PI * 1.18 : Math.PI * 0.16) + (random() - 0.5) * 0.9;
    const magnitude = (0.018 + random() * 0.038) * (counter ? 0.45 : 1);

    notes.push({
      baseX: screenX,
      baseY: 1 - screenY,
      velX: Math.cos(angle) * magnitude,
      velY: Math.sin(angle) * magnitude,
      rotation: random() * TAU,
      spin: (random() - 0.5) * 1.1,
      half: 0.012 + depth * 0.03,
      depth,
      glyph: pickGlyph(random),
      color: pickColorIndex(random),
      phase: random(),
      opacity: 0.6 + random() * 0.4,
    });
  }
  return notes;
}

/** The fixed burst pool, spawned once. Only the origin and timing change. */
export function createBurstPool(random: () => number): BurstParticle[] {
  const particles: BurstParticle[] = [];
  for (let slot = 0; slot < BURST_SLOTS; slot += 1) {
    for (let i = 0; i < BURST_PER; i += 1) {
      const angle = (i / BURST_PER) * TAU + random() * 0.5;
      const depth = 0.55 + random() * 0.45;
      particles.push({
        // For a burst particle the first three floats are direction and reach.
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        reach: 0.16 + random() * 0.2,
        rotation: random() * TAU,
        spin: (random() - 0.5) * 5,
        half: 0.011 + depth * 0.02,
        depth,
        glyph: pickGlyph(random),
        color: pickColorIndex(random),
        phase: random(),
        opacity: 0.55 + random() * 0.45,
      });
    }
  }
  return particles;
}

export function createQuietBursts(): BurstSlot[] {
  return Array.from({ length: BURST_SLOTS }, () => ({ x: 0, y: 0, start: -1000, active: 0 }));
}

/* -------------------------------------------------------------------------- */
/* Staff ribbons                                                              */
/* -------------------------------------------------------------------------- */

/** Mirrored by staffBase/staffAmplitude/staffFrequency/staffPhase in staves.wgsl. */
export const STAFF_COUNT = 4;
export const STAFF_LINE_GAP = 0.034;
/** Half-thickness of one staff line, in world units. */
export const STAFF_THICKNESS = 0.0011;
export const STAFF_OPACITY = 0.12;

/**
 * One staff line's own calm: how much of `STAFF_OPACITY` survives where the page
 * asks you to read. The ribbons are five hairlines across the whole width, so
 * they cross every heading on the page — and they had no pocket awareness at
 * all, which is one of the things that made the lower half of the landing page
 * feel busy (docs/QA_REPORT.md QA-02).
 */
export const STAFF_CALM_ALPHA = 0.25;

/** The opacity scale for one point of a staff line, given the pockets. */
export function staffCalmScale(
  rects: readonly Rect[],
  x: number,
  unitY: number
): number {
  return mix(1, STAFF_CALM_ALPHA, calmAt(rects, x, 1 - unitY));
}

export function staffBase(index: number): number {
  return 0.3 + index * 0.17;
}

export function staffAmplitude(index: number): number {
  return 0.02 + index * 0.006;
}

export function staffFrequency(index: number): number {
  return 0.85 + index * 0.3;
}

export function staffPhase(index: number): number {
  return index * 2.1;
}

/* -------------------------------------------------------------------------- */
/* Motion — the CPU mirror of notes.wgsl                                      */
/* -------------------------------------------------------------------------- */

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Hermite smoothstep, matching the WGSL builtin. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How far a pocket's edge fades, in normalised screen units. A hard edge made
 * every note flip alpha and size the instant a pocket slid over it, which read
 * as flicker while the page scrolled. Mirrors `CALM_FEATHER` in notes.wgsl.
 */
export const CALM_FEATHER = 0.03;

/** 1 well inside the rect, falling smoothly to 0 across CALM_FEATHER at its edge. */
function insideRect(rect: Rect, x: number, y: number): number {
  return (
    smoothstep(0, CALM_FEATHER, x - rect.x) *
    smoothstep(0, CALM_FEATHER, rect.x + rect.w - x) *
    smoothstep(0, CALM_FEATHER, y - rect.y) *
    smoothstep(0, CALM_FEATHER, rect.y + rect.h - y)
  );
}

export function calmAt(rects: readonly Rect[], x: number, y: number): number {
  let total = 0;
  for (const rect of rects) total += insideRect(rect, x, y);
  return Math.min(1, total);
}

export function sampleAmbient(note: NoteInstance, state: FrameState): Sample {
  // Speed is independent of scroll: a scroll-scaled rate multiplies time, so it
  // jumps each note's position whenever the page moves (the "rush").
  const speed = 0.24 + note.depth * 0.9;
  let x = fract(note.baseX + note.velX * state.time * speed);
  let y = fract(note.baseY + note.velY * state.time * speed);
  // Wrapped back into the field: a sheared note that leaves one side re-enters
  // on the other, so scrolling never leaves a dead band along the edge.
  x = fract(x + y * state.scroll * 0.2);

  // Both ripple terms read the pre-ripple position, exactly as the shader's
  // single `p +=` with a vector right-hand side does.
  const phase = note.phase * TAU;
  const rippleX = Math.sin(y * TAU + state.time * 0.1 + phase) * 0.016;
  const rippleY = Math.sin(x * 5.1 - state.time * 0.08 + phase * 1.7) * 0.016;
  x += rippleX;
  y += rippleY;

  const relX = (x - state.pointerX) * state.aspect;
  const relY = y - state.pointerY;
  const distance = Math.hypot(relX, relY);
  const push = (1 - smoothstep(0, 0.3, distance)) * state.pointerActive;
  if (push > 0) {
    const inverse = 1 / (distance + 1e-4);
    x += relX * inverse * push * 0.12 / state.aspect;
    y += relY * inverse * push * 0.12;
  }

  const edge =
    smoothstep(0, 0.06, x) *
    (1 - smoothstep(0.94, 1, x)) *
    smoothstep(0, 0.06, y) *
    (1 - smoothstep(0.94, 1, y));
  // The glyph's whole extent decides, not just its centre — see `calmForGlyph`.
  const baseHalf = note.half * (0.55 + note.depth * 0.9);
  const calm = calmForGlyph(state.calm, x, y, baseHalf, state.aspect);
  return {
    x,
    y,
    angle: note.rotation + note.spin * state.time,
    half: baseHalf * mix(1, CALM_SCALE, calm),
    alpha: note.opacity * (0.5 + note.depth * 0.5) * edge * mix(1, CALM_ALPHA, calm),
    glyph: note.glyph,
    color: note.color,
  };
}

/** Linear interpolation, matching the WGSL builtin. */
export function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * The same pocket test for a whole glyph rather than its centre.
 *
 * A note is calm only if its centre is; a glyph half inside the pocket is drawn
 * at full strength, which is exactly the note that ends up lying across a
 * heading. This takes the calm value at the centre and at the four corners of
 * the glyph's box in screen pixels, so a note is quiet as soon as any part of
 * it reaches the pocket.
 */
export function calmForGlyph(
  rects: readonly Rect[],
  x: number,
  unitY: number,
  half: number,
  aspect: number
): number {
  const y = 1 - unitY;
  const dx = half / Math.max(0.001, aspect);
  const dy = half;
  return Math.max(
    calmAt(rects, x, y),
    calmAt(rects, x - dx, y - dy),
    calmAt(rects, x + dx, y - dy),
    calmAt(rects, x - dx, y + dy),
    calmAt(rects, x + dx, y + dy)
  );
}

export function sampleBurst(
  particle: BurstParticle,
  burst: BurstSlot,
  state: FrameState
): Sample {
  const life = Math.min(1, Math.max(0, (state.time - burst.start) / BURST_LIFE));
  const flight = particle.reach * (1 - (1 - life) ** 1.7);
  const direction = Math.hypot(particle.dirX, particle.dirY) || 1;
  return {
    x: burst.x + (particle.dirX / direction) * flight / state.aspect,
    y: burst.y + (particle.dirY / direction) * flight,
    angle: particle.rotation + particle.spin * life * BURST_LIFE,
    half: particle.half * (1.15 - life * 0.85),
    alpha: particle.opacity * (1 - life) * burst.active,
    glyph: particle.glyph,
    color: particle.color,
  };
}

/* -------------------------------------------------------------------------- */
/* Quality                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Particle budget for a viewport.
 *
 * 1440×900 used to get 960 notes, which is a wall of glyphs rather than a
 * field of them — the page read as busy from the top of the programs section to
 * the footer. The divisor is roughly doubled so a desktop panel carries ~480
 * and a phone ~180: still a full-width swarm, half the ink.
 */
export function preferredCount(
  width: number,
  height: number,
  reduced: boolean,
  quality: number
): number {
  const area = Math.max(1, width * height);
  if (reduced) return Math.min(140, Math.max(40, Math.round(area / 24000)));
  const phone = Math.min(width, height) < 641;
  const density = phone ? 4200 : 2700;
  const min = phone ? 90 : 220;
  const max = phone ? 220 : 620;
  return Math.min(max, Math.max(min, Math.round((area / density) * quality)));
}

/**
 * Watches frame time and asks for less work once it stays slow. Two seconds
 * above 20ms (the 50fps line) steps the count down by a fifth, and never below
 * `MIN_QUALITY` of the computed budget.
 */
export class FrameBudget {
  private window = 0;
  private total = 0;
  private samples = 0;

  /** Returns a lower quality factor when the count should step down, else null. */
  push(deltaMs: number, quality: number): number | null {
    this.window += deltaMs / 1000;
    this.total += deltaMs;
    this.samples += 1;
    if (this.window < SLOW_WINDOW_S) return null;
    const average = this.total / Math.max(1, this.samples);
    this.window = 0;
    this.total = 0;
    this.samples = 0;
    if (average <= SLOW_FRAME_MS || quality <= MIN_QUALITY) return null;
    return Math.max(MIN_QUALITY, quality - 0.2);
  }
}

/** Cap on device pixel ratio: 2 on desktop, 1.5 on anything phone-sized. */
export function maxDevicePixelRatio(width: number, height: number): number {
  return Math.min(width, height) < 641 ? 1.5 : 2;
}
