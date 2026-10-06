/**
 * clerk_user_created — the only door onto the roster (PLATFORM_PLAN §13.2).
 *
 * Clerk calls this when an account is created. The student typed the band's join
 * code into a custom sign-up field; this function verifies the webhook really
 * came from Clerk, then hands the code to the database:
 *
 *     validate_join_code()  →  rate-limited, per-IP join-code gate
 *     register_signup()     →  creates `profiles` + `memberships` (idempotent
 *                              by clerk_id, so a redelivered webhook is a no-op)
 *
 * A wrong or missing code creates NOTHING here. The Clerk account still exists,
 * so the person lands on "You're signed in — but not on the roster yet" and can
 * sign out or try again. We answer 200 either way on purpose: a 4xx makes Clerk
 * retry, and retrying a wrong code only burns the rate-limit bucket.
 *
 * Deploy (see scripts/migrate/04_functions_config.md §4):
 *   supabase secrets set --project-ref <NEW_PROJECT_REF> \
 *     CLERK_WEBHOOK_SECRET=whsec_… BAND_SLUG=band
 *   supabase functions deploy clerk_user_created \
 *     --project-ref <NEW_PROJECT_REF> --no-verify-jwt
 *
 * `--no-verify-jwt` is required: Clerk cannot present a Supabase JWT, so the
 * svix signature above is what proves the caller. Without the flag every
 * delivery is answered 401 and nobody can join.
 *
 * The service-role key is injected by the platform as SUPABASE_SERVICE_ROLE_KEY;
 * it never appears in this file, in the repo, or in a log.
 *
 * NOT done here yet, and deliberately: banning a person in Clerk when a director
 * removes them from the roster (`deactivate_member` only touches `memberships`).
 * That is the app → Clerk direction and needs its own function.
 */

import { Webhook } from "npm:svix@1.45.1";

/** The one band. A second program would become a second slug, not a second app. */
const BAND_SLUG = Deno.env.get("BAND_SLUG") ?? "band";

interface ClerkEmailAddress {
  email_address?: string;
}

interface ClerkUser {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[] | null;
  unsafe_metadata?: Record<string, unknown> | null;
  public_metadata?: Record<string, unknown> | null;
}

interface ClerkEvent {
  type?: string;
  data?: ClerkUser;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** "Alex Rivera", else the username, else the email local part, else "". */
function displayNameOf(user: ClerkUser): string {
  const full = [user.first_name, user.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  if (user.username) return user.username.trim();

  const emails = user.email_addresses ?? [];
  const primary =
    emails.find((e) => e.email_address === user.primary_email_address_id) ??
    emails[0];
  const address = primary?.email_address ?? "";
  return address.includes("@") ? address.split("@")[0]! : address;
}

/**
 * The join code as the sign-up form sent it. `unsafe_metadata` is the dashboard
 * custom-field target and the only place a client can set without a server round
 * trip; the other names are accepted so a rename in the dashboard cannot quietly
 * lock every new student out.
 */
function joinCodeOf(user: ClerkUser): string {
  const bags = [user.unsafe_metadata, user.public_metadata];
  const keys = ["join_code", "joinCode", "band_join_code"];
  for (const bag of bags) {
    if (!bag) continue;
    for (const key of keys) {
      const value = bag[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

/** The section they picked at sign-up, if the form offered one. */
function sectionOf(user: ClerkUser): string {
  const bags = [user.unsafe_metadata, user.public_metadata];
  for (const bag of bags) {
    const value = bag?.section;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** The student's own address, so the rate-limit bucket keys on them, not Clerk. */
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() ?? "";
}

async function callRpc(name: string, body: Record<string, unknown>): Promise<{
  data: Record<string, unknown> | null;
  error: string | null;
}> {
  const url = `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${name}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { data: null, error: `HTTP ${response.status}: ${await response.text()}` };
  }
  return { data: (await response.json()) as Record<string, unknown>, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, reason: "POST only" }, 405);
  }

  const secret = Deno.env.get("CLERK_WEBHOOK_SECRET");
  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET is not set — refusing every payload.");
    return json({ ok: false, reason: "Webhook secret not configured" }, 500);
  }

  // The signature covers the raw bytes: read the body as text and verify before
  // parsing, or svix will reject a perfectly valid payload.
  const raw = await req.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(raw, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as ClerkEvent;
  } catch (e) {
    console.error("Rejected an unsigned webhook:", e instanceof Error ? e.message : e);
    return json({ ok: false, reason: "Invalid signature" }, 401);
  }

  const user = event.data ?? {};
  const clerkId = (user.id ?? "").trim();

  // A deleted account keeps its profile and attendance history on purpose: the
  // roster and the percentages must survive a student deleting their login.
  if (event.type !== "user.created") {
    return json({ ok: true, ignored: event.type ?? "unknown" });
  }

  if (!clerkId) {
    return json({ ok: false, reason: "No user id on the payload" });
  }

  const { data, error } = await callRpc("register_signup", {
    p_clerk_id: clerkId,
    p_full_name: displayNameOf(user),
    p_slug: BAND_SLUG,
    p_join_code: joinCodeOf(user),
    p_section_name: sectionOf(user),
    p_ip: clientIp(req),
  });

  if (error) {
    console.error("register_signup failed:", error);
    return json({ ok: false, reason: "Database error" }, 500);
  }

  if (data?.ok !== true) {
    // Expected for a wrong code: the account exists, the roster row does not.
    console.warn("Signup refused:", data?.message);
    return json({ ok: false, reason: data?.message ?? "Join code refused" });
  }

  return json({ ok: true, profile_id: data.profile_id, existing: data.existing === true });
});
