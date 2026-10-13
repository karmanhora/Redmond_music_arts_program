// The calm strength and size scale, mirrored from CALM_ALPHA / CALM_SCALE in
// src/components/notes/field.ts. Change one and change the other.
const CALM_ALPHA: f32 = 0.06;
const CALM_SCALE: f32 = 0.6;

// The landing page's note swarm — one instanced draw call.
//
// Every note in the field is one instance of a single quad whose corners are
// derived from `vertex_index`; there is no per-particle JavaScript. The whole
// motion (stream drift, sine ripple, tumbling, pointer push, click bursts and
// the calm zone behind the headline) is evaluated in this vertex shader from
// per-instance constants plus a small `Globals` uniform the CPU writes once per
// frame.
//
// `src/components/notes/field.ts` mirrors this arithmetic in TypeScript so the
// Canvas2D fallback engine, which steps every note on the CPU, produces the same
// picture. Change one and change the other.

struct Globals {
  // xy = origin in unit space, z = start time, w = 1 while the burst is live.
  burst0: vec4f,
  burst1: vec4f,
  burst2: vec4f,
  burst3: vec4f,
  // Readable pockets measured from the DOM, as (x, y, width, height) in
  // normalised screen space, top-left origin. Unused slots stay degenerate.
  calm0: vec4f,
  calm1: vec4f,
  calm2: vec4f,
  calm3: vec4f,
  calm4: vec4f,
  calm5: vec4f,
  time: f32,
  aspect: f32,
  pointerX: f32,
  pointerY: f32,
  pointerActive: f32,
  scroll: f32,
};

struct Palette {
  colors: array<vec4f, 5>,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<uniform> palette: Palette;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;

// Bursts occupy the head of the instance buffer, `BURST_PER` particles each.
const BURST_PER: u32 = 18u;
const BURST_TOTAL: u32 = 72u;
const BURST_LIFE: f32 = 1.4;

// Must match ATLAS_COLS / ATLAS_ROWS in atlas.ts.
const ATLAS_COLS: f32 = 4.0;
const ATLAS_ROWS: f32 = 3.0;

const TAU: f32 = 6.2831853;

struct InstanceIn {
  @location(0) a: vec4f, // base.xy (unit space), velocity.xy
  @location(1) b: vec4f, // rotation, spin, half-size, depth layer
  @location(2) c: vec4f, // glyph index, colour index, phase, opacity
};

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec4f,
  @location(2) alpha: f32,
};

// Uniform arrays are read through constant indices so no backend has to lower a
// dynamic uniform-array index.
fn burstAt(slot: u32) -> vec4f {
  if (slot == 1u) {
    return globals.burst1;
  }
  if (slot == 2u) {
    return globals.burst2;
  }
  if (slot == 3u) {
    return globals.burst3;
  }
  return globals.burst0;
}

fn colourAt(index: u32) -> vec4f {
  if (index == 1u) {
    return palette.colors[1];
  }
  if (index == 2u) {
    return palette.colors[2];
  }
  if (index == 3u) {
    return palette.colors[3];
  }
  if (index == 4u) {
    return palette.colors[4];
  }
  return palette.colors[0];
}

/// Maps a point inside a glyph cell (`local` in 0..1, y down) onto the atlas.
fn glyphUv(index: f32, local: vec2f) -> vec2f {
  let row = floor(index / ATLAS_COLS);
  let col = index - row * ATLAS_COLS;
  let cell = vec2f(1.0 / ATLAS_COLS, 1.0 / ATLAS_ROWS);
  return (vec2f(col, row) + local) * cell;
}

fn toClip(world: vec2f) -> vec2f {
  return vec2f(world.x / globals.aspect * 2.0 - 1.0, world.y * 2.0 - 1.0);
}

/// 1 when the point (normalised screen space, y down) falls inside `rect`.
fn insideRect(rect: vec4f, p: vec2f) -> f32 {
  return
    step(rect.x, p.x) *
    step(p.x, rect.x + rect.z) *
    step(rect.y, p.y) *
    step(p.y, rect.y + rect.w);
}

/// The strongest pocket hit over a glyph's box: centre and four corners, in
/// normalised screen space with the y axis returned to top-down. `dx`, `dy` are
/// the glyph's half-extents in that same space.
fn calmAt(unit: vec2f, dx: f32, dy: f32) -> f32 {
  let y = 1.0 - unit.y;
  let centre = pocketAt(vec2f(unit.x, y));
  let topLeft = pocketAt(vec2f(unit.x - dx, y - dy));
  let topRight = pocketAt(vec2f(unit.x + dx, y - dy));
  let bottomLeft = pocketAt(vec2f(unit.x - dx, y + dy));
  let bottomRight = pocketAt(vec2f(unit.x + dx, y + dy));
  return clamp(max(centre, max(max(topLeft, topRight), max(bottomLeft, bottomRight))), 0.0, 1.0);
}

/// 1 when the point is inside any pocket.
fn pocketAt(p: vec2f) -> f32 {
  return clamp(
    insideRect(globals.calm0, p) +
    insideRect(globals.calm1, p) +
    insideRect(globals.calm2, p) +
    insideRect(globals.calm3, p) +
    insideRect(globals.calm4, p) +
    insideRect(globals.calm5, p),
    0.0,
    1.0,
  );
}

@vertex
fn vs_main(
  in: InstanceIn,
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  var unit: vec2f;
  var angle: f32;
  var half: f32;
  var alpha: f32;

  if (instanceIndex < BURST_TOTAL) {
    // A click releases `BURST_PER` notes from one point, flying outward and
    // fading. An inactive slot collapses to zero alpha.
    let slot = instanceIndex / BURST_PER;
    let burst = burstAt(slot);
    let life = clamp((globals.time - burst.z) / BURST_LIFE, 0.0, 1.0);
    let flight = in.a.z * (1.0 - pow(1.0 - life, 1.7));
    let dir = normalize(in.a.xy + vec2f(1e-4, 1e-4));
    unit = burst.xy + dir * flight / vec2f(globals.aspect, 1.0);
    angle = in.b.x + in.b.y * (life * BURST_LIFE);
    half = in.b.z * mix(1.15, 0.3, life);
    alpha = in.c.w * (1.0 - life) * burst.w;
  } else {
    // Parallax: nearer (deeper) notes are bigger and travel faster.
    let speed = (0.24 + in.b.w * 0.9) * (1.0 + abs(globals.scroll) * 0.5);
    var p = fract(in.a.xy + in.a.zw * globals.time * speed);
    // Scrolling shears the stream so the page feels continuous.
    p.x += p.y * globals.scroll * 0.2;
    // A sine-based flow field: coherent sweep with slow counter-ripples.
    let phase = in.c.z * TAU;
    p += vec2f(
      sin(p.y * TAU + globals.time * 0.10 + phase),
      sin(p.x * 5.1 - globals.time * 0.08 + phase * 1.7),
    ) * 0.016;

    // The cursor pushes nearby notes away with a soft radius.
    let rel = (p - vec2f(globals.pointerX, globals.pointerY)) * vec2f(globals.aspect, 1.0);
    let push = (1.0 - smoothstep(0.0, 0.3, length(rel))) * globals.pointerActive;
    p += normalize(rel + vec2f(1e-4, 1e-4)) * push * 0.12 / vec2f(globals.aspect, 1.0);

    unit = p;
    angle = in.b.x + in.b.y * globals.time;
    half = in.b.z * (0.55 + in.b.w * 0.9);
    // Notes fade at the edges so the `fract` wrap never pops.
    let edge =
      smoothstep(0.0, 0.06, unit.x) *
      (1.0 - smoothstep(0.94, 1.0, unit.x)) *
      smoothstep(0.0, 0.06, unit.y) *
      (1.0 - smoothstep(0.94, 1.0, unit.y));
    // Calm pockets: sparse, low-contrast wherever the page asks you to read.
    // The glyph's whole extent decides, not just its centre: a note half inside
    // a pocket used to be drawn at full strength, which is exactly the one that
    // ends up lying across a heading. Mirrors `calmForGlyph` in field.ts.
    let calm = calmAt(unit, half / max(0.001, globals.aspect), half);
    alpha = in.c.w * (0.34 + in.b.w * 0.66) * edge * mix(1.0, CALM_ALPHA, calm);
    half *= mix(1.0, CALM_SCALE, calm);
  }

  let cosine = cos(angle);
  let sine = sin(angle);
  let rotated = vec2f(
    corner.x * cosine - corner.y * sine,
    corner.x * sine + corner.y * cosine,
  );
  let positioned = unit * vec2f(globals.aspect, 1.0) + rotated * half;

  var out: VertexOut;
  out.clip = vec4f(toClip(positioned), 0.0, 1.0);
  out.uv = glyphUv(in.c.x, vec2f(corner.x * 0.5 + 0.5, (1.0 - corner.y) * 0.5));
  out.tint = colourAt(u32(in.c.y + 0.5));
  out.alpha = alpha;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let coverage = textureSample(atlas, atlasSampler, in.uv).a;
  // Premultiplied, to match the surface's alpha mode.
  let a = in.tint.a * coverage * in.alpha;
  return vec4f(in.tint.rgb * a, a);
}
