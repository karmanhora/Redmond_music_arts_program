/**
 * Reads the `known` table in `src/hooks/useAuth.tsx` and checks that the
 * messages Supabase Auth actually returns land on the right friendly copy.
 *
 * Offline and dependency-free on purpose: this is the one place where a raw
 * server string ("Error sending confirmation email") would otherwise reach a
 * student's phone unchanged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(root, "src/hooks/useAuth.tsx"), "utf8");

const start = source.indexOf("const known: [RegExp, string][] = [");
if (start === -1) throw new Error("could not find the `known` table in useAuth.tsx");
const block = source.slice(start, source.indexOf("];", start));

const entry = /\[\s*\n?\s*\/((?:\\.|[^/\n])+)\/([a-z]*),\s*\n?\s*("(?:[^"\\]|\\.)*")\s*,?\s*\n?\s*\]/g;
const rules = [...block.matchAll(entry)].map((m) => ({
  re: new RegExp(m[1], m[2]),
  copy: JSON.parse(m[3]),
}));

if (rules.length === 0) throw new Error("parsed zero rules — the table's shape changed");

/** [server message, how the friendly copy must start] */
const cases = [
  ["Error sending confirmation email", "We couldn't send that email"],
  ["Error sending recovery email", "We couldn't send that email"],
  ["Error sending magic link email", "We couldn't send that email"],
  ["email rate limit exceeded", "Too many emails just now"],
  ["User already registered", "That email already has an account"],
  ["Email not confirmed", "Confirm your email first"],
  ["Invalid login credentials", "That email and password don't match"],
];

let failures = 0;
for (const [message, expected] of cases) {
  const hit = rules.find((rule) => rule.re.test(message));
  if (!hit) {
    failures++;
    console.error(`FAIL  ${message}\n      no rule matched — it would be shown verbatim`);
    continue;
  }
  if (!hit.copy.startsWith(expected)) {
    failures++;
    console.error(`FAIL  ${message}\n      got: ${hit.copy}`);
    continue;
  }
  console.log(`ok    ${message} -> ${hit.copy}`);
}

// The delivery rule must not swallow the messages that are about the person.
const delivery = rules.find((rule) => rule.re.test("Error sending confirmation email"));
if (delivery && delivery.re.test("Invalid login credentials")) {
  failures++;
  console.error("FAIL  the delivery rule matches validation errors too");
}

if (failures > 0) {
  console.error(`\n${failures} failing case(s)`);
  process.exit(1);
}
console.log(`\n${rules.length} rules, ${cases.length} messages — all mapped`);
