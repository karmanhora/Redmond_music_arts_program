/// <reference types="vite/client" />

/**
 * Frontend configuration. Supabase is the whole backend: database, RLS and
 * Supabase Auth. There is no second identity provider to configure.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
