// The undulating staff ribbons behind the note swarm.
//
// One instance per staff; each instance is one full-width band quad sized to
// span its five lines plus the wave amplitude and the line thickness. The
// fragment keeps only the pixels that land within a line half-thickness of the
// wave, so a single cheap quad per staff draws five hairline staves with no
// per-segment geometry.
//
// `src/components/notes/field.ts` mirrors the wave formula for the Canvas2D
// fallback engine.

struct StaffGlobals {
  time: f32,
  aspect: f32,
  scroll: f32,
  opacity: f32,
  lineGap: f32,
  thickness: f32,
  color: vec4f,
  // The same readable pockets the note swarm uses, as (x, y, w, h) in
  // normalised screen space with the y axis top-down. A staff is five hairlines
  // across the whole width, so without these it drew straight through every
  // heading on the page — see docs/QA_REPORT.md QA-02.
  calm0: vec4f,
  calm1: vec4f,
  calm2: vec4f,
  calm3: vec4f,
  calm4: vec4f,
  calm5: vec4f,
  calmAlpha: f32,
};

@group(0) @binding(0) var<uniform> globals: StaffGlobals;

const TAU: f32 = 6.2831853;

/// 1 when the point (normalised screen space, y down) falls inside `rect`.
fn insideRect(rect: vec4f, p: vec2f) -> f32 {
  return
    step(rect.x, p.x) *
    step(p.x, rect.x + rect.z) *
    step(rect.y, p.y) *
    step(p.y, rect.y + rect.w);
}

/// The strongest pocket hit at a point of the ribbon.
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

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(linear) world: vec2f,
  @location(1) @interpolate(flat) staff: f32,
};

// Shared with staves() in field.ts — keep the three curves in step.
fn staffBase(i: f32) -> f32 {
  return 0.30 + i * 0.17;
}

fn staffAmplitude(i: f32) -> f32 {
  return 0.020 + i * 0.006;
}

fn staffFrequency(i: f32) -> f32 {
  return 0.85 + i * 0.3;
}

fn staffPhase(i: f32) -> f32 {
  return i * 2.1;
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let staff = f32(instanceIndex);
  let halfBand = globals.lineGap * 2.0 + staffAmplitude(staff) + globals.thickness;

  var out: VertexOut;
  out.world = vec2f(corner.x * globals.aspect, staffBase(staff) + corner.y * halfBand);
  out.clip = vec4f(out.world.x / globals.aspect * 2.0 - 1.0, out.world.y * 2.0 - 1.0, 0.0, 1.0);
  out.staff = staff;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let x = in.world.x;
  let staff = in.staff;
  let wave =
    staffAmplitude(staff) *
    sin(x * staffFrequency(staff) * TAU + staffPhase(staff) + globals.time * 0.05);
  let offset = in.world.y - (staffBase(staff) + wave);
  let nearestLine = round(offset / globals.lineGap);
  let distance = abs(offset - nearestLine * globals.lineGap);
  let onLine = 1.0 - smoothstep(globals.thickness, globals.thickness * 2.6, distance);
  let withinStaff = step(abs(nearestLine), 2.0);
  // Fade both ends so a ribbon never stops at a hard vertical edge.
  let edge =
    smoothstep(0.0, 0.16, x / globals.aspect) *
    (1.0 - smoothstep(0.84, 1.0, x / globals.aspect));
  // The ribbon goes quiet wherever the page asks you to read.
  let calm = pocketAt(vec2f(x / globals.aspect, 1.0 - in.world.y));
  let a = onLine * withinStaff * edge * globals.opacity * mix(1.0, globals.calmAlpha, calm);
  return vec4f(globals.color.rgb * a, a);
}
