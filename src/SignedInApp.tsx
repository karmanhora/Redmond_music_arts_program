import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Alert, Button } from "./components/ui";
import { MusicLoader } from "./components/Splash";
import { LegalScreen } from "./screens/LegalScreen";
import { ProgramsProvider, usePrograms } from "./hooks/usePrograms";
import { AvatarUrlProvider } from "./hooks/useAvatars";
import type { PermissionCode } from "./lib/permissions";

const JoinProgramScreen = lazy(() =>
  import("./screens/JoinProgramScreen").then((module) => ({ default: module.JoinProgramScreen }))
);
const NewProgramScreen = lazy(() =>
  import("./screens/NewProgramScreen").then((module) => ({ default: module.NewProgramScreen }))
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
const AccountSettingsScreen = lazy(() =>
  import("./screens/AccountSettingsScreen").then((module) => ({
    default: module.AccountSettingsScreen,
  }))
);
const RolesScreen = lazy(() =>
  import("./screens/RolesScreen").then((module) => ({ default: module.RolesScreen }))
);

function RouteSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading screen"
      className="flex min-h-64 items-center justify-center p-6 text-[var(--cue-green)]"
    >
      <MusicLoader />
    </main>
  );
}

/** Role gate: bounce a screen the current membership cannot open. */
function RoleGate({
  need,
  children,
}: {
  need: "staff" | "director" | "program-creator";
  children: ReactNode;
}) {
  const app = usePrograms();
  const allowed =
    need === "program-creator"
      ? app.canCreateProgram
      : need === "director"
        ? app.isDirector
        : app.isStaff;
  return allowed ? <>{children}</> : <Navigate to="/" replace />;
}

/**
 * Capability gate. `RoleGate` asks about a fixed role; this asks the server's
 * own question — the same codes `has_permission()` enforces — so a screen behind
 * it can never be opened by somebody whose capabilities do not cover it.
 */
function PermissionGate({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const app = usePrograms();
  return app.can(permission) ? <>{children}</> : <Navigate to="/" replace />;
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

  // Signed in, but on no roster yet. Two ways in, so both keep their own URL:
  // join somebody's program with a code, or start your own. (Returning the join
  // screen directly — as this used to — would swallow the `/new-program` link a
  // teacher was just sent to.)
  if (app.status === "no-roster") {
    return (
      <Routes>
        <Route
          path="/new-program"
          element={
            <RoleGate need="program-creator">
              <NewProgramScreen standalone />
            </RoleGate>
          }
        />
        <Route path="*" element={<JoinProgramScreen standalone />} />
        <Route path="/privacy" element={<LegalScreen page="privacy" />} />
        <Route path="/terms" element={<LegalScreen page="terms" />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Legal pages render standalone (no app chrome) but stay reachable from
          the Profile screen once you are signed in. */}
      <Route path="/privacy" element={<LegalScreen page="privacy" />} />
      <Route path="/terms" element={<LegalScreen page="terms" />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/checkin" element={<CheckInScreen />} />
        <Route path="/me" element={<ProfileScreen />} />
        <Route path="/join" element={<JoinProgramScreen />} />
        <Route
          path="/new-program"
          element={
            <RoleGate need="program-creator">
              <NewProgramScreen />
            </RoleGate>
          }
        />
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
            <PermissionGate permission="attendance.view_analytics">
              <AnalyticsScreen />
            </PermissionGate>
          }
        />
        <Route path="/settings" element={<AccountSettingsScreen />} />
        <Route
          path="/roles"
          element={
            <PermissionGate permission="roles.view">
              <RolesScreen />
            </PermissionGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * The app behind the sign-in. There is no bridge component any more: the Supabase
 * client holds its own session, so the moment `useAuth` says "signed in" the same
 * client is already authenticating every query below it.
 */
export default function SignedInApp() {
  return (
    <ProgramsProvider>
      {/* Private avatar paths are resolved to signed URLs once per screen, so
          the provider wraps everything that can render an `Avatar`. */}
      <AvatarUrlProvider>
        <Suspense fallback={<RouteSkeleton />}>
          <ProgramRoutes />
        </Suspense>
      </AvatarUrlProvider>
    </ProgramsProvider>
  );
}
