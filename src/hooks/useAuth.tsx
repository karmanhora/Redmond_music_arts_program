import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/**
 * The signed-in session, from Supabase Auth.
 *
 * This is the whole of the app's idea of "who is signed in": one subscription to
 * Supabase Auth, plus the five calls the screens need. Everything below it —
 * `profiles`, memberships, roles, RLS — resolves the caller server-side from the
 * token this hook holds the mirror of, so no screen ever decides who they are.
 *
 * The identity that matters is `userId`: it is `auth.uid()`, the value stored in
 * `profiles.auth_user_id` (supabase/migrations/021), which is how the database
 * maps an account to a person.
 */

export type AuthStatus = "loading" | "signed-out" | "signed-in";

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** `auth.uid()` — the value `profiles.auth_user_id` holds. */
  userId: string | null;
  email: string | null;
  /** Name the account was created with, if we ever asked for one. */
  displayName: string | null;
  /**
   * True when the page was opened from a password-recovery link. The app shows
   * "set a new password" and nothing else until that is done (or skipped).
   */
  recovering: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (redirectTo: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /** Re-send the sign-up confirmation; email confirmation is on for this project. */
  resendConfirmation: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Supabase's messages are accurate and technical; these are the handful students
 * actually meet, said the way the rest of the app talks. Anything not listed —
 * including any network or server fault — is passed through untouched, because
 * hiding it is how a "wrong password" ends up masking a broken deployment.
 */
function readable(message: string): string {
  const text = message.trim();

  // The minimum length is a project setting, not a constant: quote whatever the
  // server says rather than a number this file would have to guess.
  const tooShort = text.match(/password should be at least (\d+)/i);
  if (tooShort) return `Your password needs to be at least ${tooShort[1]} characters.`;

  const known: [RegExp, string][] = [
    [/invalid login credentials/i, "That email and password don't match. Check them and try again."],
    [/email not confirmed/i, "Confirm your email first — we sent you a link when you signed up."],
    [
      /user already registered/i,
      "That email already has an account. Sign in instead, or reset the password.",
    ],
    [
      /new password should be different/i,
      "That is your current password — pick a new one.",
    ],
    [/unable to validate email address|invalid format/i, "That doesn't look like an email address."],
    [
      /email rate limit exceeded|over_email_send_rate_limit/i,
      "Too many emails just now — wait a minute and try again.",
    ],
    [
      /security purposes|only request this after/i,
      "Just a moment — wait a few seconds before trying that again.",
    ],
    [
      /auth session missing|session_not_found/i,
      "Your sign-in link has expired. Ask for a new one.",
    ],
  ];
  for (const [pattern, friendly] of known) {
    if (pattern.test(text)) return friendly;
  }
  return text || "Something went wrong. Try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let active = true;

    // The stored session, if there is one — this is what makes a refresh keep
    // you signed in, and what makes the first paint after a reload correct
    // rather than a flash of the landing page.
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signed-in" : "signed-out");
    });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setStatus(next ? "signed-in" : "signed-out");
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      // A sign-out must drop the recovery screen too, or the next person on a
      // shared phone would land on a password form they cannot submit.
      if (event === "SIGNED_OUT") setRecovering(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const clearRecovery = useCallback(() => {
    setRecovering(false);
    // The token is spent once we have the new password; drop it from the URL so
    // a refresh (or a shared link) cannot replay it.
    const url = new URL(window.location.href);
    for (const key of ["code", "error", "error_description", "type"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? readable(error.message) : null };
  }, []);

  const signInWithGoogle = useCallback(async (redirectTo: string) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    return { error: error ? readable(error.message) : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Supabase Auth is the record of "who is this account"; `profiles` is the
      // record of "who is this person", and it is created on the join screen.
      // The name here is only a convenience for the confirmation email.
      options: {
        data: displayName?.trim() ? { full_name: displayName.trim() } : undefined,
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (error) return { error: readable(error.message), needsConfirmation: false };
    // With email confirmation on (this project's setting) `signUp` returns no
    // session, so the person has to confirm before the app will let them in.
    return { error: null, needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error ? readable(error.message) : null };
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    return { error: error ? readable(error.message) : null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error ? readable(error.message) : null };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
      displayName:
        (session?.user?.user_metadata?.full_name as string | undefined)?.trim() || null,
      recovering,
      clearRecovery,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      sendPasswordReset,
      resendConfirmation,
      updatePassword,
    }),
    [
      status,
      session,
      recovering,
      clearRecovery,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      sendPasswordReset,
      resendConfirmation,
      updatePassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The signed-in session. Only valid inside `<AuthProvider>`. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
