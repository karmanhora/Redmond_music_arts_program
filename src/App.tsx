import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { ToastProvider, Skeleton } from "./components/ui";
import { WelcomeScreen } from "./screens/WelcomeScreen";

const AuthScreen = lazy(() =>
  import("./screens/AuthScreen").then((module) => ({ default: module.AuthScreen }))
);
const SignedInApp = lazy(() => import("./SignedInApp"));

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

export default function App() {
  return (
    <ToastProvider>
      <SignedOut>
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/" element={<WelcomeScreen />} />
            <Route path="/sign-in/*" element={<AuthScreen mode="sign-in" />} />
            <Route path="/sign-up/*" element={<AuthScreen mode="sign-up" />} />
            <Route path="*" element={<AuthScreen mode="sign-in" />} />
          </Routes>
        </Suspense>
      </SignedOut>

      <SignedIn>
        <Suspense fallback={<RouteSkeleton />}>
          <SignedInApp />
        </Suspense>
      </SignedIn>
    </ToastProvider>
  );
}
