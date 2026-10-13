/**
 * The single lazy entry point to the note field.
 *
 * This module is the only file in `src/components/notes/` that the landing page
 * reaches, and it is reached with `import()` after first paint. Everything else
 * — the glyph atlas, both engines, vgpu — hangs off it, so none of it is in the
 * initial bundle. Even the theme colours and the fallback factory are surfaced
 * from here, so `NotesField` needs no second static edge into the directory.
 *
 * WebGPU is chosen when the browser exposes it and `init()` succeeds; every
 * other outcome (no `navigator.gpu`, no adapter, no device, a throw anywhere in
 * setup) lands on the Canvas2D renderer. This never throws at the caller: a
 * visitor with an unusual GPU gets a slower picture, never an error.
 */
import { createCanvasEngine } from "./canvas2d";
import { readPalette, readStaffColor } from "./palette";
import type { NoteColor } from "./palette";
import type { EngineContext, NotesEngine } from "./field";

export type EngineKind = "webgpu" | "canvas";

export interface BootedEngine {
  engine: NotesEngine;
  kind: EngineKind;
}

export interface FieldPalette {
  /** The five indexed note colours. */
  colors: NoteColor[];
  /** The staff ribbons' colour. */
  staff: NoteColor;
}

/**
 * Resolves the field's colours from live custom properties. Called at start and
 * again whenever the theme flips, because the values — not the variable names —
 * are what the engines hold.
 */
export function fieldPalette(element: Element): FieldPalette {
  return { colors: readPalette(element), staff: readStaffColor(element) };
}

/** The Canvas2D renderer, for a handover after a device loss. */
export function createFallbackEngine(context: EngineContext): NotesEngine {
  return createCanvasEngine(context);
}

/**
 * `?notes=canvas` forces the fallback and `?notes=webgpu` forces the GPU path —
 * how the two engines are exercised without changing browser flags. Anything
 * else, including `?notes=off`, is handled by the caller before this runs.
 */
export async function createNotesEngine(
  context: EngineContext,
  force: string | null = null
): Promise<BootedEngine> {
  if (force !== "canvas" && typeof navigator !== "undefined" && navigator.gpu !== undefined) {
    try {
      const { createGpuEngine } = await import("./gpu");
      return { engine: await createGpuEngine(context), kind: "webgpu" };
    } catch {
      // No adapter, no device, a driver that refuses the format, a shader that
      // will not compile on this stack — all the same answer: draw it in 2D.
    }
  }
  return { engine: createCanvasEngine(context), kind: "canvas" };
}
