import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Alert, Button, Skeleton } from "./components/ui";
import { setClerkTokenGetter } from "./lib/supabase";
import { ProgramsProvider, usePrograms } from "./hooks/usePrograms";

const JoinProgramScreen = lazy(() =>
  import("./screens/JoinProgramScreen").then((module) => ({ default: module.JoinProgramScreen }))
);
const HomeScreen = lazy(() =>
  import("./screens/HomeScreen").then((module) => ({ default: module.HomeScreen }))
);
const CalendarScreen = lazy(() =>
  import("./screens/CalendarScreen").then((module) => ({ default: module.CalendarScreen }))
);
const CheckInScreen = lazy(() =>
  import("./screens/CheckInScreen").then((module) => ({ default: module.CheckInScreen }))
);
const AttendanceScreen = lazy(() =>
  import("./screens/AttendanceScreen").then((module) => ({ default: module.AttendanceScreen }))
);
const RosterScreen = lazy(() =>
  import("./screens/RosterScreen").then((module) => ({ default: module.RosterScreen }))
);
const AnalyticsScreen = lazy(() =>
  import("./screens/AnalyticsScreen").then((module) => ({ default: module.AnalyticsScreen }))
);
const ProfileScreen = lazy(() =>
  import("./screens/ProfileScreen").then((module) => ({ default: module.ProfileScreen }))
);

function RouteSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading screen"
      className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6"
    >
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </main>
  );
}

/** Install the session token getter before mounting anything that reads data. */
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

  if (!ready) return <RouteSkeleton />;
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

  if (app.status === "loading") return <RouteSkeleton />;

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

  if (app.status === "no-roster") return <JoinProgramScreen standalone />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/checkin" element={<CheckInScreen />} />
        <Route path="/me" element={<ProfileScreen />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function SignedInApp() {
  return (
    <ClerkSupabaseBridge>
      <ProgramsProvider>
        <Suspense fallback={<RouteSkeleton />}>
          <ProgramRoutes />
        </Suspense>
      </ProgramsProvider>
    </ClerkSupabaseBridge>
  );
}
