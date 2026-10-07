const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when both Supabase values look real (see ConfigMissingScreen). */
export const isBackendConfigured = Boolean(
  url && anonKey && url.startsWith("http") && !url.includes("YOUR-PROJECT")
);
