/**
 * Everything the signed-in screens read, as fixtures.
 *
 * The dev server these tests run against is started with the dummy
 * `VITE_SUPABASE_URL=https://qa-fixture.supabase.co`, so intercepting that host
 * is enough to render any screen without a database, a network, or a real
 * account. Nothing here is a schema change — these are the exact columns the
 * `select()` statements in `src/lib/queries.ts` ask for.
 *
 * Plain JavaScript on purpose: the Playwright specs import it (they are
 * transpiled) and so does `.tools/qa/measure.mjs` (which is plain Node).
 */

export const SUPABASE_HOST = "https://qa-fixture.supabase.co";
const AUTH_STORAGE_KEY = "rhs-music-arts-auth";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
export const PROGRAM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_BRASS = "44444444-4444-4444-8444-444444444444";
const SECTION_WW = "55555555-5555-4555-8555-555555555555";
const SECTION_PERC = "77777777-7777-4777-8777-777777777777";

const NOW = new Date("2026-10-12T18:00:00.000Z");
const days = (n) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** A deliberately long name, so truncation and wrapping are under test. */
export const profile = {
  id: PROFILE_ID,
  auth_user_id: USER_ID,
  display_name: "Alexandria K. Montgomery-Worthington",
  full_name: "Alexandria K. Montgomery-Worthington",
  email: "alexandria.montgomery-worthington@example.org",
  instrument: "Trombone",
  grade_level: "11",
  avatar_path: null,
  avatar_url: null,
  bio: null,
  deactivated: false,
  must_change_password: false,
  created_at: "2026-09-01T00:00:00.000Z",
};

const ensemble = {
  id: PROGRAM_ID,
  slug: "band",
  name: "RHS Mustang Band",
  short_name: "Band",
  theme_color: "#17402b",
  logo_url: null,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
};

/**
 * A second program on purpose. The masthead's program switcher only renders when
 * a user is in more than one (`inSeveral` in `AppShell`), so with a single
 * membership in the fixtures that control — and everything inside the sheet it
 * opens — was invisible to every instrument in this repo. A director in a school
 * with a band and an orchestra is the normal case, not the exotic one.
 */
const ORCHESTRA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const orchestra = {
  id: ORCHESTRA_ID,
  slug: "orchestra",
  name: "RHS Chamber Orchestra",
  short_name: "Orchestra",
  theme_color: "#3d5a78",
  logo_url: null,
  active: true,
  created_at: "2026-08-01T00:00:00.000Z",
};

const memberships = [
  {
    id: "66666666-6666-4666-8666-666666666666",
    user_id: PROFILE_ID,
    ensemble_id: PROGRAM_ID,
    section_id: SECTION_WW,
    roles: ["member", "director"],
    active: true,
    joined_at: "2026-09-01T00:00:00.000Z",
    email_upcoming_events: true,
    ensemble,
    section: { id: SECTION_WW, name: "Woodwinds", sort_order: 2 },
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    user_id: PROFILE_ID,
    ensemble_id: ORCHESTRA_ID,
    section_id: null,
    roles: ["member"],
    active: true,
    joined_at: "2026-09-10T00:00:00.000Z",
    email_upcoming_events: false,
    ensemble: orchestra,
    section: null,
  },
];

const sections = [
  { id: SECTION_BRASS, ensemble_id: PROGRAM_ID, name: "Brass", sort_order: 1 },
  { id: SECTION_WW, ensemble_id: PROGRAM_ID, name: "Woodwinds", sort_order: 2 },
  { id: SECTION_PERC, ensemble_id: PROGRAM_ID, name: "Percussion and colorguard", sort_order: 3 },
];

const events = [
  {
    id: "88888888-8888-4888-8888-888888888888",
    ensemble_id: PROGRAM_ID,
    title: "Marching rehearsal — homecoming set",
    date: days(0),
    start_time: "15:30:00",
    end_time: "17:30:00",
    location: "RHS Band Room",
    type: "rehearsal",
    notes: null,
    archived: false,
    created_at: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    ensemble_id: PROGRAM_ID,
    title: "Friday night football vs. Bellevue",
    date: days(3),
    start_time: "19:00:00",
    end_time: "22:00:00",
    location: "Mustang Stadium",
    type: "performance",
    notes: null,
    archived: false,
    created_at: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ensemble_id: PROGRAM_ID,
    title: "Winter concert dress rehearsal and instrument check-in",
    date: days(9),
    start_time: "16:00:00",
    end_time: "18:00:00",
    location: "Performing Arts Center",
    type: "rehearsal",
    notes: null,
    archived: false,
    created_at: "2026-09-01T00:00:00.000Z",
  },
];

/** The roster: the caller plus five people, each in a named section. */
const OTHERS = [
  ["Marcus Ellery", "Trumpet", SECTION_BRASS],
  ["Priya Raghunathan-Villanueva", "Clarinet", SECTION_WW],
  ["Devon Okafor", "Percussion", SECTION_PERC],
  ["Hana Lindqvist", "Flute", SECTION_WW],
  ["Theodore Barbarossa", "Sousaphone", SECTION_BRASS],
];

const people = [
  { ...profile, __section: SECTION_WW },
  ...OTHERS.map(([name, instrument, sectionId], i) => ({
    id: `bbbbbbb${i}-bbbb-4bbb-8bbb-bbbbbbbbbbb1`,
    auth_user_id: null,
    display_name: name,
    full_name: name,
    email: null,
    instrument,
    grade_level: "11",
    avatar_path: null,
    avatar_url: null,
    bio: null,
    deactivated: false,
    must_change_password: false,
    created_at: "2026-09-01T00:00:00.000Z",
    __section: sectionId,
  })),
];

const rosterRows = people.map((p, i) => ({
  user_id: p.id,
  section_id: p.__section,
  roles: i === 0 ? ["member", "director"] : ["member"],
  active: true,
  joined_at: "2026-09-01T00:00:00.000Z",
  profile: p,
  section: sections.find((s) => s.id === p.__section) ?? null,
}));

const STATUSES = ["present", "late", "excused", "absent", "present", "present"];
const attendanceRows = rosterRows.map((r, i) => ({
  id: `ccccccc${i}-cccc-4ccc-8ccc-ccccccccccc1`,
  event_id: events[0].id,
  user_id: r.user_id,
  status: STATUSES[i] ?? "present",
  checked_in_at: "2026-10-12T15:31:00.000Z",
  method: "qr",
  notes: null,
  recorded_by: PROFILE_ID,
  created_at: "2026-10-12T15:31:00.000Z",
}));

const permissions = [
  "attendance.view",
  "attendance.record",
  "attendance.override",
  "attendance.view_analytics",
  "roster.view",
  "roster.manage",
  "roles.view",
  "roles.assign",
  "roles.revoke",
  "attendance.manage_events",
  "events.manage",
  "program.manage_settings",
  "profile.manage_users",
];

/** PostgREST answers: table name → rows. Unknown tables answer `[]`. */
const TABLES = {
  profiles: [profile],
  memberships,
  sections,
  ensemble_theme_tokens: [{ tokens: {} }],
  events,
  attendance_records: attendanceRows,
  attendance_staff_notes: [],
  checkin_sessions: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      event_id: events[0].id,
      token: "A7K2M9QP",
      started_at: "2026-10-12T15:00:00.000Z",
      ended_at: null,
      created_by: PROFILE_ID,
    },
  ],
  notifications: [
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      user_id: PROFILE_ID,
      title: "Homecoming rehearsal moved",
      body: "The Wednesday rehearsal now starts at 15:30.",
      read: false,
      created_at: "2026-10-11T20:00:00.000Z",
    },
  ],
  personal_events: [],
  user_role_assignments: [],
  roles: [
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ensemble_id: PROGRAM_ID,
      name: "Uniform crew lead",
      slug: "uniform_crew_lead",
      description: "Runs the uniform room on performance nights.",
      system: false,
      created_at: "2026-09-05T00:00:00.000Z",
    },
  ],
  role_permissions: [],
  permissions: [],
  ensembles: [ensemble, orchestra],
  audit_logs: [],
  program_admins: [],
};

const RPC_RESULTS = {
  get_signup_account_type: "teacher",
  /**
   * The teacher credential (migration 035). The fixture persona *declared*
   * teacher at sign-up and has not redeemed an invitation, which is the state
   * the pending copy and the invitation form exist for. It is also carried by a
   * program as its director, so `mayStartProgram` stays true and the
   * start-a-program form still renders — the two are independent, exactly as the
   * server treats them.
   */
  teacher_access_status: { ok: true, verified: false, pending: true, admin: false },
  my_permissions: { ok: true, permissions },
  get_my_attendance_pct: 92,
  get_my_attendance_trend: [
    { month: "2026-08", pct: 88 },
    { month: "2026-09", pct: 94 },
    { month: "2026-10", pct: 92 },
  ],
  get_event_attendance_summary: { ok: true, present: 24, late: 2, excused: 1, absent: 1, total: 28 },
  get_section_attendance_stats: [
    { section: "Brass", pct: 94, present: 10, total: 11 },
    { section: "Woodwinds", pct: 88, present: 8, total: 9 },
    { section: "Percussion and colorguard", pct: 76, present: 6, total: 8 },
  ],
  get_join_code: { ok: true, code: "RHSBAND" },
  get_digest_reachability: {
    ok: true,
    reachable: 24,
    skipped: [
      { reason: "turned it off", count: 3 },
      { reason: "no working account behind the row", count: 2 },
    ],
  },
  list_active_programs: [
    { slug: "band", name: "RHS Mustang Band", color: "#17402b", has_code: true },
    { slug: "orchestra", name: "RHS Chamber Orchestra", color: "#3d5a78", has_code: false },
  ],
};

/** List-shaped RPCs answer with `[]`; the rest answer `{ok:true}`. */
const LIST_RPCS = new Set([
  "get_attendance_trend",
  "get_student_attendance_pct",
  "list_program_roles",
  "list_role_audit",
]);

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range",
      "content-range": Array.isArray(body) ? `0-${body.length - 1}/${body.length}` : "0-0/1",
    },
    body: JSON.stringify(body),
  });
}

export function routeSupabase(page) {
  return page.route(`${SUPABASE_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    // Auth: the session is seeded in localStorage, so nothing here should be
    // reached. Answering keeps a stray refresh off the real network.
    if (path.startsWith("/auth/v1/")) {
      if (path.includes("/user")) return json(route, { id: USER_ID, email: profile.email });
      if (path.includes("/token")) return json(route, {}, 400);
      return json(route, {});
    }

    if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.slice("/rest/v1/rpc/".length);
      if (fn in RPC_RESULTS) return json(route, RPC_RESULTS[fn]);
      return json(route, LIST_RPCS.has(fn) ? [] : { ok: true });
    }

    if (path.startsWith("/rest/v1/")) {
      const table = path.slice("/rest/v1/".length);
      if (method !== "GET") return json(route, null, 201);
      return json(route, TABLES[table] ?? []);
    }

    // Storage (signed avatar URLs) and functions: empty, so `Avatar` falls back
    // to initials rather than showing a broken image.
    if (path.startsWith("/storage/v1/")) return json(route, []);
    return json(route, { ok: false, error: "not mocked" }, 404);
  });
}

/**
 * Sign the browser in without a network round-trip: Supabase reads its session
 * from `localStorage`, and `autoRefreshToken` is defeated by a far-future
 * expiry. The stored shape is the library's `Session`.
 */
export async function signIn(page) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const session = {
    access_token: "qa-fixture-access-token",
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 7,
    expires_at: expiresAt,
    refresh_token: "qa-fixture-refresh-token",
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: profile.email,
      email_confirmed_at: "2026-09-01T00:00:00.000Z",
      phone: "",
      confirmed_at: "2026-09-01T00:00:00.000Z",
      last_sign_in_at: "2026-10-12T00:00:00.000Z",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      identities: [],
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-10-12T00:00:00.000Z",
      is_anonymous: false,
    },
  };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [AUTH_STORAGE_KEY, JSON.stringify(session)]
  );
}

export async function installMocks(page, signedIn = false) {
  if (signedIn) await signIn(page);
  await routeSupabase(page);
}
