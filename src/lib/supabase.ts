import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when both Supabase values look real (see ConfigMissingScreen). */
export const isBackendConfigured = Boolean(
  url && anonKey && url.startsWith("http") && !url.includes("YOUR-PROJECT")
);

/**
 * Clerk owns the session. Supabase never stores one, so every request carries a
 * freshly minted Clerk session token as the bearer token — that is the whole of
 * the "Clerk as a Supabase Third-Party Auth provider" wiring (PLATFORM_PLAN §13).
 *
 * The token getter needs React context (`useAuth().getToken`), so it is injected
 * once by `<ClerkSupabaseBridge />` instead of imported here.
 */
type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setClerkTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder",
  {
    // No Supabase Auth session: Clerk is the identity provider.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => {
      if (!tokenGetter) return null;
      try {
        return await tokenGetter();
      } catch {
        // A failed token fetch must degrade to `anon`, whose policies grant
        // nothing — never to a stale token.
        return null;
      }
    },
  }
);
