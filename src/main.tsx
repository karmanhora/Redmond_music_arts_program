import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ConfigMissingScreen } from "./screens/ConfigMissingScreen";
import { isBackendConfigured } from "./lib/backend-config";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "./index.css";

/**
 * Supabase is the only backend now: the database *and* the identity provider, so
 * the two frontend values below are all this app needs to boot. There is no
 * provider component to mount — the client in `lib/supabase.ts` owns the session
 * and `AuthProvider` (inside `App`) reads it.
 */
const missing: string[] = [];
if (!isBackendConfigured) {
  missing.push("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY");
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const root = createRoot(container);

if (missing.length > 0) {
  root.render(<ConfigMissingScreen missing={missing} />);
} else {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
}
