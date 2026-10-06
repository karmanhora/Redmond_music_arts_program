import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import { ConfigMissingScreen } from "./screens/ConfigMissingScreen";
import { isBackendConfigured } from "./lib/supabase";
import "./index.css";

const publishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const missing: string[] = [];
if (!isBackendConfigured) {
  missing.push("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY");
}
if (!publishableKey) missing.push("VITE_CLERK_PUBLISHABLE_KEY");

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const root = createRoot(container);

if (missing.length > 0) {
  root.render(<ConfigMissingScreen missing={missing} />);
} else {
  root.render(
    <StrictMode>
      <ClerkProvider
        publishableKey={publishableKey as string}
        afterSignOutUrl="/"
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ClerkProvider>
    </StrictMode>
  );
}
