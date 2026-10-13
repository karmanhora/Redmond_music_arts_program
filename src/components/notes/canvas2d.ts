/**
 * The fallback engine: the same field, drawn with Canvas2D.
 *
 * It runs whenever `navigator.gpu` is missing, adapter or device creation
 * fails, or the WebGPU device is lost mid-session — so it has to look like the
 * GPU engine rather than like a consolation prize. It gets there by reusing the
 * same glyph atlas, the same palette and the same motion arithmetic from
 * `field.ts`, and by blitting one pre-tinted atlas copy per note instead of
 * stroking vector paths, which is what keeps hundreds of notes affordable.
 *
 * Reduced motion is honoured by drawing exactly one static frame: no loop, no
 * pointer response, no bursts.
 */
import { ATLAS_COLS, buildAtlas, tintAtlas } from "./atlas";
import type { GlyphAtlas } from "./atlas";
import { toCss } from "./palette";
import {
  BURST_LIFE,
  BURST_PER,
  BURST_SLOTS,
  FrameBudget,
  STAFF_CALM_ALPHA,
  STAFF_COUNT,
  STAFF_LINE_GAP,
  STAFF_OPACITY,
  STAFF_THICKNESS,
  calmAt,
  mix,
  createAmbient,
  createBurstPool,
  createQuietBursts,
  maxDevicePixelRatio,
  mulberry32,
  preferredCount,
  sampleAmbient,
  sampleBurst,
  staffAmplitude,
  staffBase,
  staffFrequency,
  staffPhase,
} from "./field";
import type {
  BurstParticle,
  BurstSlot,
  EngineContext,
  FrameState,
  NoteInstance,
  NotesEngine,
  Rect,
  Sample,
} from "./field";

const TAU = Math.PI * 2;
/** Beyond this a frame is treated as a resume, not as elapsed time. */
const MAX_STEP_S = 0.064;
const STAFF_SEGMENTS = 28;
/** Fixed, so a resize or a calm-zone update re-spawns the same field. */
const FIELD_SEED = 0x51f7a1;

export function createCanvasEngine(context: EngineContext): NotesEngine {
  const { canvas, reduced, staff } = context;
  const ctx = canvas.getContext("2d");

  const atlas: GlyphAtlas | null = buildAtlas();
  const tints: Array<HTMLCanvasElement | null> = context.colors.map((color) =>
    atlas && ctx ? tintAtlas(atlas, toCss(color)) : null
  );

  const pool: BurstParticle[] = createBurstPool(mulberry32(FIELD_SEED));
  const bursts: BurstSlot[] = createQuietBursts();
  let notes: NoteInstance[] = [];
  const calm: Rect[] = [];

  let quality = 1;
  const budget = new FrameBudget();
  let running = false;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let cursor = 0;
  let width = 1;
  let height = 1;
  let aspect = 1;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = 0;
  let scroll = 0;
  let destroyed = false;

  const snapshot: FrameState = {
    time: 0,
    aspect,
    pointerX,
    pointerY,
    pointerActive,
    scroll,
    calm,
  };

  function measure(): void {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    aspect = width / height;
    const ratio = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio(width, height));
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rebuild(): void {
    notes = createAmbient(preferredCount(width, height, reduced, quality), mulberry32(FIELD_SEED), calm);
  }

  function drawStaves(): void {
    if (!ctx) return;
    ctx.strokeStyle = toCss(staff);
    ctx.lineWidth = Math.max(1, STAFF_THICKNESS * height * 2);
    for (let staffIndex = 0; staffIndex < STAFF_COUNT; staffIndex += 1) {
      const base = staffBase(staffIndex);
      const amplitude = staffAmplitude(staffIndex);
      const frequency = staffFrequency(staffIndex);
      const phase = staffPhase(staffIndex);
      for (let line = -2; line <= 2; line += 1) {
        const unitY = base + line * STAFF_LINE_GAP;
        // A ribbon is one path, but its calm varies along it, so each segment
        // is stroked with the scale for its own midpoint. A 12px step is far
        // below one heading's height, so the step is invisible.
        for (let segment = 0; segment < STAFF_SEGMENTS; segment += 1) {
          const u0 = segment / STAFF_SEGMENTS;
          const u1 = (segment + 1) / STAFF_SEGMENTS;
          const wave0 = amplitude * Math.sin(u0 * frequency * TAU + phase + elapsed * 0.05);
          const wave1 = amplitude * Math.sin(u1 * frequency * TAU + phase + elapsed * 0.05);
          const quiet = calmAt(calm, (u0 + u1) / 2, 1 - (unitY + (wave0 + wave1) / 2));
          ctx.globalAlpha = STAFF_OPACITY * mix(1, STAFF_CALM_ALPHA, quiet);
          ctx.beginPath();
          ctx.moveTo(u0 * width, (1 - (unitY + wave0)) * height);
          ctx.lineTo(u1 * width, (1 - (unitY + wave1)) * height);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawNote(sample: Sample): void {
    if (!ctx || !atlas || sample.alpha <= 0.004) return;
    const tint = tints[sample.color];
    if (!tint) return;
    const size = sample.half * 2 * height;
    if (size <= 0.5) return;
    const row = Math.floor(sample.glyph / ATLAS_COLS);
    ctx.globalAlpha = Math.min(1, sample.alpha);
    ctx.save();
    ctx.translate(sample.x * width, (1 - sample.y) * height);
    // Canvas rotates clockwise for a positive angle and its y axis points down,
    // so the shader's anticlockwise world angle is negated here.
    ctx.rotate(-sample.angle);
    ctx.drawImage(
      tint,
      (sample.glyph - row * ATLAS_COLS) * atlas.cell,
      row * atlas.cell,
      atlas.cell,
      atlas.cell,
      -size / 2,
      -size / 2,
      size,
      size
    );
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function render(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    snapshot.time = elapsed;
    snapshot.aspect = aspect;
    snapshot.pointerX = pointerX;
    snapshot.pointerY = pointerY;
    snapshot.pointerActive = pointerActive;
    snapshot.scroll = scroll;
    drawStaves();
    for (const note of notes) drawNote(sampleAmbient(note, snapshot));
    let live = false;
    for (const burst of bursts) {
      if (snapshot.time - burst.start < BURST_LIFE) live = true;
    }
    if (!live) return;
    for (let slot = 0; slot < BURST_SLOTS; slot += 1) {
      const burst = bursts[slot];
      if (!burst) continue;
      for (let i = 0; i < BURST_PER; i += 1) {
        const particle = pool[slot * BURST_PER + i];
        if (particle) drawNote(sampleBurst(particle, burst, snapshot));
      }
    }
  }

  function tick(now: number): void {
    if (!running) return;
    const step = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += step;
    const nextQuality = budget.push(step * 1000, quality);
    if (nextQuality !== null) {
      quality = nextQuality;
      rebuild();
    }
    render();
    frame = window.requestAnimationFrame(tick);
  }

  function halt(): void {
    running = false;
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  measure();
  rebuild();

  return {
    start(): void {
      // Reduced motion gets one static, sparse frame and no loop at all.
      if (reduced) {
        render();
        return;
      }
      if (running || destroyed) return;
      running = true;
      last = performance.now();
      frame = window.requestAnimationFrame(tick);
    },
    stop: halt,
    resize(): void {
      measure();
      rebuild();
      if (reduced) render();
    },
    setPointer(x: number | null, y: number | null): void {
      if (reduced || x === null || y === null) {
        pointerActive = 0;
        return;
      }
      pointerX = x;
      // Screen space is y-down; the field is y-up.
      pointerY = 1 - y;
      pointerActive = 1;
    },
    setScroll(scrollY: number): void {
      const limit = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scroll = Math.max(-1, Math.min(1, (scrollY / limit) * 2 - 1));
    },
    setCalm(rects: readonly Rect[]): void {
      calm.length = 0;
      for (const rect of rects) calm.push(rect);
      rebuild();
      if (reduced) render();
    },
    burst(x: number, y: number): void {
      // Reduced motion shows a single still frame, so a burst would be a lie.
      if (reduced) return;
      const slot = bursts[cursor % BURST_SLOTS];
      cursor += 1;
      if (!slot) return;
      slot.x = x;
      slot.y = 1 - y;
      slot.start = elapsed;
      slot.active = 1;
      if (!running) {
        // The loop is paused (hidden tab, hero off-screen); draw the seed frame
        // so the burst is not silently swallowed.
        last = performance.now();
        render();
      }
    },
    destroy(): void {
      destroyed = true;
      halt();
      notes = [];
    },
  };
}
