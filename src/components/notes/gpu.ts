/**
 * The primary engine: vgpu + WebGPU.
 *
 * The whole swarm is one instanced draw call. Every note is one instance of a
 * single quad and its motion is evaluated in `notes.wgsl`; the CPU writes a
 * small uniform once per frame and never touches a particle. The staff ribbons
 * are a second, four-instance draw that keeps only the pixels landing on a
 * hairline of its wave.
 *
 * `createGpuEngine` is async and throws when the adapter cannot be acquired —
 * that throw is the caller's cue to run the Canvas2D engine instead. Every
 * failure after that (device loss, a runtime GPU error) is reported through
 * `context.onFallback` rather than surfaced to the visitor.
 */
import { draw, frameLoop, geometry, init, sampler, surface, texture } from "vgpu";
import type { Draw, Frame, FrameLoopHandle, Geometry, Gpu, Surface, Texture } from "vgpu";

import notesShader from "./notes.wgsl";
import stavesShader from "./staves.wgsl";
import { buildAtlas } from "./atlas";
import { toUnits } from "./palette";
import {
  BURST_TOTAL,
  FrameBudget,
  STAFF_CALM_ALPHA,
  STAFF_COUNT,
  STAFF_LINE_GAP,
  STAFF_OPACITY,
  STAFF_THICKNESS,
  createAmbient,
  createBurstPool,
  createQuietBursts,
  maxDevicePixelRatio,
  mulberry32,
  preferredCount,
} from "./field";
import type {
  BurstParticle,
  BurstSlot,
  EngineContext,
  NoteInstance,
  NotesEngine,
  Rect,
} from "./field";

/** Twelve floats per instance: three `vec4f` vertex attributes. */
const STRIDE = 12 * 4;
/** Ceiling from `preferredCount`, plus the fixed burst pool. */
const MAX_AMBIENT = 1500;
const CAPACITY = MAX_AMBIENT + BURST_TOTAL;
const FIELD_SEED = 0x51f7a1;
/** Beyond this a frame is treated as a resume, not as elapsed time. */
const MAX_STEP_S = 0.064;
const QUIET_BURST: [number, number, number, number] = [0, 0, -1000, 0];

export async function createGpuEngine(context: EngineContext): Promise<NotesEngine> {
  const { canvas, colors, reduced, staff } = context;
  const gpu: Gpu = await init();

  const atlas = buildAtlas();

  const canvasSurface: Surface = surface(gpu, canvas, {
    label: "notes",
    // Cap device pixel ratio: 2 on desktop, 1.5 on a phone-sized viewport.
    dpr: [1, maxDevicePixelRatio(window.innerWidth, window.innerHeight)],
    alphaMode: "premultiplied",
    clearColor: [0, 0, 0, 0],
  });

  const atlasTexture: Texture | null = atlas
    ? texture(gpu, {
        kind: "2d",
        size: [atlas.width, atlas.height],
        format: "rgba8unorm",
        // `copyExternalImageToTexture` requires COPY_DST *and* RENDER_ATTACHMENT
        // on its destination, even though nothing renders into this one.
        usage: ["texture_binding", "copy_dst", "render_attachment"],
        label: "note-atlas",
      })
    : null;
  if (atlasTexture && atlas) {
    // One upload, straight from the offscreen canvas the fallback blits. Going
    // through `copyExternalImageToTexture` keeps the pixels on the GPU side —
    // no `getImageData` readback, and so no forced software-backed canvas.
    gpu.gpu.queue.copyExternalImageToTexture(
      { source: atlas.source },
      { texture: atlasTexture.gpu, premultipliedAlpha: false },
      [atlas.width, atlas.height]
    );
  }

  const atlasSampler = sampler(gpu, {
    label: "note-atlas-sampler",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const instances = new Float32Array(CAPACITY * 12);
  const notesGeometry: Geometry = geometry(gpu, {
    label: "note-instances",
    vertexCount: 6,
    instanceCount: CAPACITY,
    buffers: [
      {
        label: "note-instance-stream",
        stepMode: "instance",
        stride: STRIDE,
        data: instances,
        attributes: {
          a: { format: "float32x4", location: 0 },
          b: { format: "float32x4", location: 1 },
          c: { format: "float32x4", location: 2 },
        },
      },
    ],
  });

  // --- Mutable state. Declared before the draws because the first uniform
  // value is read from it during construction. ---
  const pool: BurstParticle[] = createBurstPool(mulberry32(FIELD_SEED));
  const bursts: BurstSlot[] = createQuietBursts();
  let notes: NoteInstance[] = [];
  const calm: Rect[] = [];

  let quality = 1;
  const budget = new FrameBudget();
  let ambient = 0;
  // What the current placement was made for; see canvas2d.ts for the rules.
  let placedWidth = -1;
  let placedAgainstCalm = false;
  let aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = 0;
  let scroll = 0;
  let elapsed = 0;
  let last = 0;
  let cursor = 0;
  let handle: FrameLoopHandle | undefined;
  let destroyed = false;
  let reported = false;
  let rendered = 0;

  const palette = { colors: colors.map(toUnits) };

  const notesDraw: Draw = draw(gpu, {
    label: "notes",
    shader: notesShader,
    geometry: notesGeometry,
    instances: BURST_TOTAL,
    blend: "premultiplied",
    set: {
      globals: globalsValue(),
      palette,
      atlas: atlasTexture,
      atlasSampler,
    },
  });

  const stavesDraw: Draw = draw(gpu, {
    label: "staves",
    shader: stavesShader,
    vertices: 6,
    instances: STAFF_COUNT,
    blend: "premultiplied",
    set: { globals: staffValue() },
  });

  function burstValue(index: number): [number, number, number, number] {
    const burst = bursts[index];
    return burst ? [burst.x, burst.y, burst.start, burst.active] : QUIET_BURST;
  }

  function rectValue(index: number): [number, number, number, number] {
    const rect = calm[index];
    return rect ? [rect.x, rect.y, rect.w, rect.h] : [-1, -1, 0, 0];
  }

  function globalsValue(): Record<string, unknown> {
    return {
      burst0: burstValue(0),
      burst1: burstValue(1),
      burst2: burstValue(2),
      burst3: burstValue(3),
      calm0: rectValue(0),
      calm1: rectValue(1),
      calm2: rectValue(2),
      calm3: rectValue(3),
      calm4: rectValue(4),
      calm5: rectValue(5),
      time: elapsed,
      aspect,
      pointerX,
      pointerY,
      pointerActive,
      scroll,
    };
  }

  function staffValue(): Record<string, unknown> {
    return {
      time: elapsed,
      aspect,
      scroll,
      opacity: STAFF_OPACITY,
      lineGap: STAFF_LINE_GAP,
      thickness: STAFF_THICKNESS,
      color: toUnits(staff),
      // The ribbons read the same pockets the notes do, so a heading is quiet
      // for both layers rather than only one of them.
      calm0: rectValue(0),
      calm1: rectValue(1),
      calm2: rectValue(2),
      calm3: rectValue(3),
      calm4: rectValue(4),
      calm5: rectValue(5),
      calmAlpha: STAFF_CALM_ALPHA,
    };
  }

  /** Bursts first, then the ambient field — the order `notes.wgsl` expects. */
  function pack(): void {
    let at = 0;
    for (const particle of pool) {
      instances[at++] = particle.dirX;
      instances[at++] = particle.dirY;
      instances[at++] = particle.reach;
      instances[at++] = 0;
      instances[at++] = particle.rotation;
      instances[at++] = particle.spin;
      instances[at++] = particle.half;
      instances[at++] = particle.depth;
      instances[at++] = particle.glyph;
      instances[at++] = particle.color;
      instances[at++] = particle.phase;
      instances[at++] = particle.opacity;
    }
    for (let i = 0; i < ambient; i += 1) {
      const note = notes[i];
      if (!note) break;
      instances[at++] = note.baseX;
      instances[at++] = note.baseY;
      instances[at++] = note.velX;
      instances[at++] = note.velY;
      instances[at++] = note.rotation;
      instances[at++] = note.spin;
      instances[at++] = note.half;
      instances[at++] = note.depth;
      instances[at++] = note.glyph;
      instances[at++] = note.color;
      instances[at++] = note.phase;
      instances[at++] = note.opacity;
    }
    notesGeometry.write(instances);
  }

  function rebuild(): void {
    const [width, height] = canvasSurface.size;
    ambient = Math.min(MAX_AMBIENT, preferredCount(width, height, reduced, quality));
    placedWidth = width;
    placedAgainstCalm = calm.length > 0;
    notes = createAmbient(ambient, mulberry32(FIELD_SEED), calm);
    pack();
  }

  function fallBack(reason: string): void {
    if (reported || destroyed) return;
    reported = true;
    context.onFallback(reason);
  }

  function stop(): void {
    handle?.stop();
    handle = undefined;
  }

  function tick(frame: Frame): void {
    // Reduced motion renders exactly one frame; anything after that is dropped
    // even if the loop has not stopped scheduling yet.
    if (reduced && rendered >= 1) {
      stop();
      return;
    }

    const now = performance.now();
    const step = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += step;

    const nextQuality = budget.push(step * 1000, quality);
    if (nextQuality !== null) {
      quality = nextQuality;
      rebuild();
    }

    notesDraw.set({ globals: globalsValue() });
    stavesDraw.set({ globals: staffValue() });

    frame.pass({ target: canvasSurface, clear: [0, 0, 0, 0] }, (pass) => {
      pass.draw(stavesDraw);
      pass.draw(notesDraw, { instances: ambient + BURST_TOTAL });
    });

    rendered += 1;
    if (reduced) stop();
  }

  const unsubscribeResize = canvasSurface.onResize((event) => {
    aspect = Math.max(1, event.width) / Math.max(1, event.height);
    // Mobile browsers fire `resize` as the address bar collapses mid-scroll. A
    // height-only change must not reshuffle the field under the reader.
    const count = Math.min(MAX_AMBIENT, preferredCount(event.width, event.height, reduced, quality));
    if (event.width !== placedWidth || count !== ambient) rebuild();
    else pack();
  });
  const unsubscribeError = gpu.onError(() => fallBack("runtime-error"));
  void gpu.lost.then(() => fallBack("device-lost"));

  rebuild();

  return {
    start(): void {
      if (handle || destroyed) return;
      last = performance.now();
      handle = frameLoop(gpu, tick);
    },
    stop,
    resize(): void {
      rebuild();
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
      // Pockets move with the page on every scroll frame. The shader already dims
      // them per frame, so only the first placement needs to avoid them.
      if (!placedAgainstCalm && calm.length > 0) rebuild();
    },
    burst(x: number, y: number): void {
      // Reduced motion shows a single still frame, so a burst would be a lie.
      if (reduced) return;
      const slot = bursts[cursor % bursts.length];
      cursor += 1;
      if (!slot) return;
      slot.x = x;
      slot.y = 1 - y;
      slot.start = elapsed;
      slot.active = 1;
    },
    destroy(): void {
      destroyed = true;
      stop();
      unsubscribeResize();
      unsubscribeError();
      notesDraw.dispose();
      stavesDraw.dispose();
      notesGeometry.destroy();
      atlasTexture?.destroy();
      gpu.dispose();
      notes = [];
    },
  };
}
