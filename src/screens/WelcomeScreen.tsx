import { SignIn, SignUp } from "@clerk/clerk-react";
import { useLocation } from "react-router-dom";
import { APP_NAME, ORG_NAME } from "../lib/constants";

/**
 * Sign-in / sign-up. Clerk *is* the auth system (PLATFORM_PLAN §13), so these
 * are Clerk's own components — themed to the band tokens rather than reimplemented.
 *
 * A `/checkin?token=…` deep link from a wall-mounted QR code must survive the
 * round trip through sign-in, so the token is passed back as the post-auth
 * redirect.
 */
export function WelcomeScreen({ mode }: { mode: "sign-in" | "sign-up" }) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");
  const afterAuth = token ? `/checkin?token=${encodeURIComponent(token)}` : "/";

  const appearance = {
    variables: {
      colorPrimary: "var(--band-primary)",
      colorText: "var(--band-ink)",
      colorBackground: "#ffffff",
      borderRadius: "0.75rem",
      fontFamily: "var(--font-sans)",
      fontSize: "15px",
    },
    elements: {
      rootBox: "w-full",
      card: "shadow-none border-0 bg-transparent p-0 w-full",
      headerTitle: "hidden",
      headerSubtitle: "hidden",
      socialButtonsBlockButton:
        "h-11 rounded-xl border border-black/10 hover:bg-black/[0.03]",
      formButtonPrimary:
        "h-11 rounded-xl bg-band text-sm font-semibold normal-case hover:bg-band-deep",
      formFieldInput: "h-11 rounded-xl border-black/10",
      footerActionLink: "text-band font-semibold",
      footer: "bg-transparent",
    },
  } as const;

  return (
    <div className="flex min-h-full flex-col bg-surface dark:bg-[#0c0f0a]">
      {/* Brand hero */}
      <div className="safe-t bg-band px-6 pt-10 pb-8 text-white">
        <img src="/logo-dark.svg" alt="" className="h-14 w-14" />
        <p className="text-[11px] font-bold tracking-widest text-white/70 uppercase">
          {ORG_NAME}
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 max-w-xs text-sm text-white/80">
          Every program&rsquo;s attendance and calendar in one place — check in in one tap and
          never miss a rehearsal.
        </p>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 py-6">
        <div className="w-full max-w-sm">
          {mode === "sign-in" ? (
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              forceRedirectUrl={afterAuth}
              appearance={appearance}
            />
          ) : (
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              forceRedirectUrl={afterAuth}
              appearance={appearance}
            />
          )}
          <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {mode === "sign-in" ? (
              <>
                New to a program?{" "}
                <a className="font-semibold text-band underline dark:text-emerald-300" href="/sign-up">
                  Create your account
                </a>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <a className="font-semibold text-band underline dark:text-emerald-300" href="/sign-in">
                  Sign in
                </a>
              </>
            )}
          </p>
          <p className="mt-2 text-center text-[11px] text-zinc-400">
            Ask your director for your program&rsquo;s join code before you sign up.
          </p>
        </div>
      </div>
    </div>
  );
}
