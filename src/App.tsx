import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Splash } from "./components/Splash";
import { Alert, Button, ToastProvider } from "./components/ui";
import { setClerkTokenGetter } from "./lib/supabase";
import { ProgramsProvider, usePrograms } from "./hooks/usePrograms";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { JoinProgramScreen } from "./screens/JoinProgramScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { CheckInScreen } from "./screens/CheckInScreen";
import { AttendanceScreen } from "./screens/AttendanceScreen";
import { RosterScreen } from "./screens/RosterScreen";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";

/**
 * Hands the Clerk session token to the Supabase client. It must be installed
 * *before* any data is requested, so the tree below stays unmounted until it is.
 */
function ClerkSupabaseBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setClerkTokenGetter(() => getToken());
    setReady(true);
    return () => {
      setClerkTokenGetter(null);
      setReady(false);
    };
  }, [getToken]);

  if (!ready) return <Splash label="Signing you in…" />;
  return <>{children}</>;
}

/** Role gate: bounce a screen the current membership cannot open. */
function RoleGate({ need, children }: { need: "staff" | "director"; children: ReactNode }) {
  const app = usePrograms();
  const allowed = need === "director" ? app.isDirector : app.isStaff;
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}

/** Everything that requires a resolved program membership. */
function ProgramRoutes() {
  const app = usePrograms();

  if (app.status === "loading") return <Splash label="Loading your programs…" />;

  if (app.status === "error") {
    return (
      <div className="safe-t flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <Alert tone="error">{app.error ?? "Could not load your programs."}</Alert>
          <Button
            block
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void app.refresh()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // Signed in, but on no roster at all: the only thing to do is join one.
  if (app.status === "no-roster") return <JoinProgramScreen standalone />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/checkin" element={<CheckInScreen />} />
        <Route path="/me" element={<ProfileScreen />} />
        {/* Joining is reachable from the switcher, Profile and the roster's empty state. */}
        <Route path="/join" element={<JoinProgramScreen />} />
        <Route
          path="/attendance"
          element={
            <RoleGate need="staff">
              <AttendanceScreen />
            </RoleGate>
          }
        />
        <Route
          path="/roster"
          element={
            <RoleGate need="staff">
              <RosterScreen />
            </RoleGate>
          }
        />
        <Route
          path="/analytics"
          element={
            <RoleGate need="director">
              <AnalyticsScreen />
            </RoleGate>
          }
        />
        {/* Any stray URL (including an old bookmark) lands on the home screen. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <SignedOut>
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/sign-in/*" element={<AuthScreen mode="sign-in" />} />
          <Route path="/sign-up/*" element={<AuthScreen mode="sign-up" />} />
          <Route path="*" element={<AuthScreen mode="sign-in" />} />
        </Routes>
      </SignedOut>

      <SignedIn>
        <ClerkSupabaseBridge>
          <ProgramsProvider>
            <ProgramRoutes />
          </ProgramsProvider>
        </ClerkSupabaseBridge>
      </SignedIn>
    </ToastProvider>
  );
}
