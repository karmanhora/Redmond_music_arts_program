#!/usr/bin/env node
// ============================================================================
// clerk_import.mjs — hash-preserving bulk user import into Clerk.
// ----------------------------------------------------------------------------
// Reads out/clerk_import.jsonl (one Clerk CreateUser payload per line; built by
// 03b_clerk_import.sh from the auth.users dump) and creates the users through
// the Clerk Backend API, carrying each Supabase bcrypt password hash so
// existing passwords keep working (docs/PLATFORM_PLAN.md §13).
//
// Usage:
//   node clerk_import.mjs                 DRY RUN (default): counts rows and
//                                         prints external_ids only — no writes.
//   node clerk_import.mjs --apply         actually create users (requires
//                                         CLERK_SECRET_KEY in the environment).
//   node clerk_import.mjs --limit 2       process only the first N rows (the
//                                         hash-acceptance spike uses this).
//   node clerk_import.mjs --file path     alternate input file.
//
// Idempotent: rows whose external_id (fallback: email) already exists in Clerk
// are skipped, so the import is safely re-runnable.
//
// SECURITY: the input file contains password hashes. Nothing secret is ever
// logged; on failure only the external_id and Clerk's error message print.
// ============================================================================
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const valOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APPLY = hasFlag("--apply");
const LIMIT = Number(valOf("--limit", "0")) || 0;
const FILE = valOf("--file", new URL("./out/clerk_import.jsonl", import.meta.url).pathname);
const SECRET = process.env.CLERK_SECRET_KEY || "";
const API = "https://api.clerk.com/v1";

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!existsSync(FILE)) fail(`Input file not found: ${FILE} — run 03b_clerk_import.sh first.`);
if (APPLY && !SECRET) fail("CLERK_SECRET_KEY is required for --apply (set it in .env; the value is never printed).");
if (!APPLY && !SECRET) console.log("No CLERK_SECRET_KEY set — dry run cannot check for already-imported users; all rows will be reported as pending.");

async function clerk(path, init = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function alreadyImported(u) {
  if (!SECRET) return false;
  // Prefer the external_id lookup (our uuid); fall back to email matching.
  for (const q of [`external_id=${encodeURIComponent(u.external_id)}`,
                   `email_address=${encodeURIComponent((u.email_address?.[0] ?? ""))}`]) {
    if (q.endsWith("=")) continue;
    const res = await clerk(`/users?limit=1&${q}`);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
  }
  return false;
}

async function createUser(u) {
  // Payload keys verified at the Phase 1 hash spike: Supabase stores bcrypt
  // ($2a$) via crypt(pw, gen_salt('bf',10)); Clerk accepts it as
  // password_digest with password_hasher "bcrypt" and re-hashes transparently.
  // If the spike rejects these keys, see the fallback note in
  // docs/PLATFORM_PLAN.md §13.3 (trickle migration / Clerk migration tool).
  const body = {
    external_id: u.external_id,
    email_address: u.email_address,
    first_name: u.first_name || undefined,
    last_name: u.last_name || undefined,
    password_digest: u.password_digest,
    password_hasher: "bcrypt",
    skip_password_requirement: true,
  };
  const res = await clerk("/users", { method: "POST", body: JSON.stringify(body) });
  if (res.ok) return { ok: true };
  const detail = await res.text();
  return { ok: false, status: res.status, detail: detail.slice(0, 300) };
}

const rows = [];
const rl = createInterface({ input: createReadStream(FILE, "utf8") });
for await (const line of rl) {
  if (!line.trim()) continue;
  rows.push(JSON.parse(line));
  if (LIMIT > 0 && rows.length >= LIMIT) break;
}

console.log(`Rows to process: ${rows.length}${LIMIT ? ` (limit ${LIMIT})` : ""} from ${FILE}`);
console.log(`Mode: ${APPLY ? "APPLY — creating users in Clerk" : "DRY RUN — no writes"}`);

let created = 0, skipped = 0, failed = 0, pending = 0;
for (const u of rows) {
  const label = u.external_id;
  if (await alreadyImported(u)) {
    skipped += 1;
    console.log(`  skip    ${label} (already in Clerk)`);
    continue;
  }
  if (!APPLY) {
    pending += 1;
    console.log(`  pending ${label}`);
    continue;
  }
  const r = await createUser(u);
  if (r.ok) {
    created += 1;
    console.log(`  created ${label}`);
  } else {
    failed += 1;
    console.log(`  FAILED  ${label} (HTTP ${r.status}): ${r.detail}`);
  }
  // Conservative pacing under Clerk's Backend API rate limits.
  await new Promise((res) => setTimeout(res, 250));
}

console.log(`\nDone. created=${created} skipped=${skipped} pending(dry-run)=${pending} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
