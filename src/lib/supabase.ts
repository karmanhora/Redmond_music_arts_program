import { createClient } from "@supabase/supabase-js";
import { isBackendConfigured } from "./backend-config";

export { isBackendConfigured };

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * The one Supabase client. Supabase Auth owns the session, and the client keeps
 * it: `persistSession` writes it to localStorage, `autoRefreshToken` renews it
 * before it expires, and `detectSessionInUrl` finishes the email flows
 * (confirmation, recovery, invite) that come back as a URL.
 *
 * Nothing here has to be wired by hand any more: the previous Clerk setup kept
 * its own session and injected a fresh token as the request bearer (see
 * docs/AUTH_MIGRATION.md §2). Supabase now signs the request itself, so the same
 * client serves both identity and data — one place for "who am I", and no
 * third-party script between a page load and the first query.
 *
 * The anon key is public by design; it grants nothing on its own, because every
 * table is behind RLS (supabase/migrations/015) and every identity helper
 * resolves the caller from the JWT `sub` claim (021). The service-role key must
 * never appear in this file or anywhere else the browser can read.
 */
export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Scoped to this app so it cannot collide with another Supabase project
      // served from the same origin during development.
      storageKey: "rhs-music-arts-auth",
      // `flowType` is intentionally left at the library default (implicit).
      // A PKCE link can only be completed in the browser that asked for it,
      // and a student who requests a reset on a laptop and opens the mail on
      // their phone would be locked out. See docs/AUTH_MIGRATION.md §5.
    },
  }
);
