import { SignIn, SignUp } from "@clerk/clerk-react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Music2 } from "lucide-react";
import { APP_NAME } from "../lib/constants";

type AuthMode = "sign-in" | "sign-up";

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");
  const afterAuth = token ? `/checkin?token=${encodeURIComponent(token)}` : "/";
  const isSignIn = mode === "sign-in";

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
    <main className="safe-t flex min-h-full items-center justify-center overflow-y-auto bg-[#f7f7f3] px-4 py-8 text-zinc-950 dark:bg-[#10110f] dark:text-zinc-100 sm:px-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-black/5 dark:bg-zinc-950 dark:ring-white/10 md:min-h-[620px] md:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative isolate flex min-h-56 flex-col justify-between overflow-hidden bg-[#171914] p-6 text-white sm:p-9 md:min-h-full">
          <div className="absolute -right-16 -bottom-20 h-64 w-64 rounded-full border border-white/10" />
          <div className="absolute -right-7 -bottom-11 h-44 w-44 rounded-full border border-amber-200/20" />
          <div className="relative">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-white/80 transition hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
            <div className="mt-9 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300 text-zinc-950 shadow-lg shadow-amber-300/20">
              <Music2 className="h-6 w-6" />
            </div>
            <p className="mt-5 text-xs font-bold tracking-[0.18em] text-amber-200 uppercase">
              {APP_NAME}
            </p>
            <h1 className="mt-3 text-3xl leading-tight font-black sm:text-4xl">
              {isSignIn ? "Welcome back." : "Join your program."}
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
              {isSignIn
                ? "Sign in to see your program, events, and attendance."
                : "Create your account to get started with your music and arts program."}
            </p>
          </div>
          <p className="relative mt-8 text-xs text-white/50">
            Redmond High School Music &amp; Arts
          </p>
        </aside>

        <section className="flex items-center justify-center p-5 sm:p-9 md:p-10">
          <div className="w-full max-w-md animate-in">
            <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">
              {isSignIn ? "Your account" : "New account"}
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">
              {isSignIn ? "Sign in" : "Create your account"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {isSignIn
                ? "Use the email address connected to your program."
                : "Use the email address you want associated with your program."}
            </p>

            <div className="mt-6">
              {isSignIn ? (
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
            </div>

            {!isSignIn ? (
              <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
                After creating your account, you&rsquo;ll enter your
                program&rsquo;s join code. Ask your director if you don&rsquo;t
                have one yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
