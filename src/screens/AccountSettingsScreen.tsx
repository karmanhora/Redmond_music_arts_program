import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Clock,
  FileText,
  KeyRound,
  LogOut,
  Mail,
  MailWarning,
  MonitorSmartphone,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  Field,
  Input,
  Row,
  SectionTitle,
  SegmentedControl,
  Skeleton,
  Toggle,
  useToast,
} from "../components/ui";
import { ProfileForm } from "../components/ProfileForm";
import { CapabilityList, RoleBadges } from "../components/CapabilityList";
import { updateMyProfile } from "../lib/queries";
import { fmtDate } from "../lib/date";
import { APP_NAME, ORG_NAME } from "../lib/constants";
import { useAuth } from "../hooks/useAuth";
import { useDark } from "../hooks/useDark";
import { usePrograms } from "../hooks/usePrograms";
import { useReducedMotion } from "../hooks/useReducedMotion";

type Tab = "profile" | "security" | "preferences" | "privacy";

/**
 * `/settings` — everything about your own account, in one place.
 *
 * Split by what it actually affects: who you are (profile), how you sign in
 * (security), how the app behaves for you (preferences), and what happens to
 * your records (privacy). Nothing here is decorative: there is deliberately no
 * notification toggle, because this app has no notification channel to switch —
 * the in-app bell is fed by the `notifications` table and is always on.
 *
 * Credentials are never touched by this app's database. Passwords, the email
 * address and session revocation all go straight to Supabase Auth.
 */
export function AccountSettingsScreen() {
  const app = usePrograms();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("profile");

  if (!app.profile) {
    return (
      <div className="space-y-3 p-4 pb-6">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      <SectionTitle>Account settings</SectionTitle>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        className="sticky top-0 z-10"
        options={[
          { value: "profile", label: "Profile" },
          { value: "security", label: "Security" },
          { value: "preferences", label: "Preferences" },
          { value: "privacy", label: "Privacy" },
        ]}
      />

      {tab === "profile" ? <ProfileTab /> : null}
      {tab === "security" ? <SecurityTab /> : null}
      {tab === "preferences" ? <PreferencesTab /> : null}
      {tab === "privacy" ? <PrivacyTab /> : null}

      <div className="space-y-1">
        <Card className="p-1">
          <Row
            icon={<FileText className="h-5 w-5" />}
            title="Privacy Policy"
            subtitle="What is collected, who can see it, and how to request deletion"
            onClick={() => navigate("/privacy")}
          />
          <Row
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Terms of Use"
            subtitle="The rules for using the app"
            onClick={() => navigate("/terms")}
          />
        </Card>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          {APP_NAME} is part of {ORG_NAME}.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

function ProfileTab() {
  const app = usePrograms();
  const auth = useAuth();
  if (!app.profile) return null;

  return (
    <div className="space-y-4">
      <Card>
        <ProfileForm
          profile={app.profile}
          authUserId={auth.userId ?? ""}
          onSaved={() => app.refresh()}
        />
      </Card>

      <div className="space-y-1">
        <SectionTitle>What you can change</SectionTitle>
        <Card className="space-y-3">
          <CapabilityList permissions={app.permissions} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Your roles and program membership are set by your program&rsquo;s staff, not here — a
            profile change can never grant a role or move you between programs. Ask your director if
            something looks wrong.
          </p>
        </Card>
      </div>

      <div className="space-y-1">
        <SectionTitle>Roles & programs</SectionTitle>
        <Card className="space-y-3">
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">In {app.program?.name}</p>
            <RoleBadges roles={app.roles} className="mt-1.5" />
          </div>
          <ul className="space-y-1 border-t border-[var(--cue-border)] pt-3">
            {app.memberships.map((membership) => (
              <li key={membership.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{membership.ensemble.name}</span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                  {membership.roles?.join(", ") || "student"}
                  {membership.section?.name ? ` · ${membership.section.name}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {app.membership?.joined_at ? (
            <p className="border-t border-[var(--cue-border)] pt-3 text-xs text-zinc-500 dark:text-zinc-400">
              On this roster since {fmtDate(new Date(app.membership.joined_at))}.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

function SecurityTab() {
  const app = usePrograms();
  const auth = useAuth();
  const { toast } = useToast();

  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmOthers, setConfirmOthers] = useState(false);

  async function changeEmail() {
    const value = newEmail.trim();
    if (!value) {
      setEmailError("Type the new email address.");
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    const { error } = await auth.updateEmail(value);
    setSavingEmail(false);
    if (error) {
      setEmailError(error);
      return;
    }
    setNewEmail("");
    toast.success("Check both inboxes to confirm the change.");
  }

  async function changePassword() {
    if (!password) {
      setPasswordError("Type your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Those two passwords don't match.");
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    const { error } = await auth.updatePassword(password);
    if (error) {
      setSavingPassword(false);
      setPasswordError(error);
      return;
    }

    // `must_change_password` is our own flag on `profiles`, not an Auth one:
    // a director who issues a temporary password sets it, and setting your own
    // password clears it.
    if (app.profile?.must_change_password) {
      await updateMyProfile(app.profile.id, { must_change_password: false });
      await app.refresh();
    }

    setSavingPassword(false);
    setPassword("");
    setConfirmPassword("");
    toast.success("Password updated.");
  }

  async function resend() {
    if (!auth.email) return;
    setBusy("resend");
    const { error } = await auth.resendConfirmation(auth.email);
    setBusy(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Confirmation email sent.");
  }

  async function emailReset() {
    if (!auth.email) return;
    setBusy("reset");
    const { error } = await auth.sendPasswordReset(auth.email);
    setBusy(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Reset link sent — it lands on the “set a new password” screen.");
  }

  async function signOutOthers() {
    setBusy("others");
    const { error } = await auth.signOutOthers();
    setBusy(null);
    setConfirmOthers(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Every other session was signed out.");
  }

  return (
    <div className="space-y-4">
      {/* --- email --- */}
      <div className="space-y-1">
        <SectionTitle>Email</SectionTitle>
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
              <Mail className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{auth.email ?? "No address on file"}</p>
              <div className="mt-1">
                {auth.emailVerified ? (
                  <Badge className="bg-band/12 text-band-deep dark:bg-band/25 dark:text-emerald-200">
                    <BadgeCheck aria-hidden="true" className="mr-1 h-3 w-3" /> Verified
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                    <MailWarning aria-hidden="true" className="mr-1 h-3 w-3" /> Not verified yet
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {!auth.emailVerified ? (
            <Alert tone="warn">
              Confirm this address so you can reset your password if you forget it.
              <div className="mt-2">
                <Button size="sm" variant="secondary" loading={busy === "resend"} onClick={() => void resend()}>
                  Resend confirmation email
                </Button>
              </div>
            </Alert>
          ) : null}

          <div className="space-y-3 border-t border-[var(--cue-border)] pt-3">
            {emailError ? <Alert tone="error">{emailError}</Alert> : null}
            <Field
              label="Change email address"
              hint="We email both the old and new address; the change applies once both are confirmed."
            >
              <Input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="new.address@example.com"
                autoComplete="email"
              />
            </Field>
            <Button size="sm" variant="secondary" loading={savingEmail} onClick={() => void changeEmail()}>
              Send confirmation links
            </Button>
          </div>
        </Card>
      </div>

      {/* --- password --- */}
      <div className="space-y-1">
        <SectionTitle>Password</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This is the password you sign in with. It is held by the sign-in service (Supabase
            Auth), never by this app&rsquo;s database.
          </p>
          {app.profile?.must_change_password ? (
            <Alert tone="info">
              Your director issued you a temporary password. Setting your own clears this note.
            </Alert>
          ) : null}
          {passwordError ? <Alert tone="error">{passwordError}</Alert> : null}
          <Field label="New password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={savingPassword} icon={<KeyRound className="h-4 w-4" />} onClick={() => void changePassword()}>
              Change password
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "reset"}
              icon={<Wand2 className="h-4 w-4" />}
              onClick={() => void emailReset()}
            >
              Email me a reset link
            </Button>
          </div>
        </Card>
      </div>

      {/* --- sessions --- */}
      <div className="space-y-1">
        <SectionTitle>Sessions</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={<MonitorSmartphone className="h-5 w-5" />}
            title="Sign out of other devices"
            subtitle="Keeps this device signed in; ends every other session."
            onClick={() => setConfirmOthers(true)}
          />
          <Row
            icon={<LogOut className="h-5 w-5" />}
            title="Sign out"
            subtitle="You'll need your password again on this device."
            onClick={() => setConfirmSignOut(true)}
          />
        </Card>
      </div>

      <ConfirmSheet
        open={confirmOthers}
        title="Sign out of other devices?"
        body="Any other phone, tablet or computer signed in as you is signed out. This device stays signed in."
        confirmLabel="Sign out other devices"
        tone="primary"
        loading={busy === "others"}
        onCancel={() => setConfirmOthers(false)}
        onConfirm={() => void signOutOthers()}
      />
      <ConfirmSheet
        open={confirmSignOut}
        title="Sign out?"
        body="You'll need your login again to check in. Nothing on the roster changes."
        confirmLabel="Sign out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => void auth.signOut()}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

function PreferencesTab() {
  const { dark, toggle } = useDark();
  const { preference, setPreference, reduced } = useReducedMotion();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SectionTitle>Appearance</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            title="Dark mode"
            subtitle={dark ? "On — easier at night" : "Off — follows your device"}
            trailing={<Toggle checked={dark} onChange={toggle} label="Dark mode" />}
          />
        </Card>
      </div>

      <div className="space-y-1">
        <SectionTitle>Motion</SectionTitle>
        <Card className="space-y-3">
          <SegmentedControl
            value={preference}
            onChange={setPreference}
            options={[
              { value: "system", label: "Follow device" },
              { value: "reduced", label: "Reduce motion" },
              { value: "full", label: "Full motion" },
            ]}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {reduced
              ? "Screen transitions and movement are reduced on this device."
              : "Screen transitions play normally. Choose “Reduce motion” to turn them off."}
          </p>
        </Card>
      </div>

      <div className="space-y-1">
        <SectionTitle>Notifications</SectionTitle>
        <Card>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This app has one notification channel — the bell in the header, fed by your program&rsquo;s
            events and open check-ins. There is nothing to configure yet, so there is no toggle here
            pretending otherwise.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Privacy & data                                                             */
/* -------------------------------------------------------------------------- */

function PrivacyTab() {
  const app = usePrograms();
  const auth = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setDeleting(true);
    setError(null);
    const { error: failure } = await auth.deleteAccount().catch((thrown: unknown) => ({
      error: thrown instanceof Error ? thrown.message : "Account deletion failed unexpectedly.",
    }));
    setDeleting(false);
    if (failure) {
      setError(failure);
      return;
    }
    setConfirmDelete(false);
    toast.success("Your account has been deleted.");
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SectionTitle>Your records</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Your name, picture and biography belong to your account and can be changed at any time
            from the Profile tab. Your attendance record is a school record.
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <UserRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-band dark:text-emerald-300" />
              <span>
                <strong>Deleted when you ask:</strong> your sign-in account, and your profile details
                (name, picture, biography).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Clock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-band dark:text-emerald-300" />
              <span>
                <strong>Kept, de-identified:</strong> attendance already recorded is retained under
                &ldquo;Deleted account&rdquo; so the program&rsquo;s records stay accurate. No name or picture
                remains attached.
              </span>
            </li>
          </ul>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Retention follows the school district&rsquo;s records policy. To inspect, correct or delete a
            record before then, contact your school&rsquo;s records office (LWSD Policy 3231).
          </p>
        </Card>
      </div>

      <div className="space-y-1">
        <SectionTitle>Request help</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            If something is wrong with your account — a name misspelled, the wrong program, a record
            that should be corrected — ask your director first. They can fix rosters and attendance
            directly.
          </p>
          <Button variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => navigate("/privacy")}>
            Read the privacy notice
          </Button>
        </Card>
      </div>

      <div className="space-y-1">
        <SectionTitle>Delete your account</SectionTitle>
        <Card className="space-y-3">
          <Alert tone="warn">
            This is permanent. It removes your sign-in account and profile details. Attendance
            history is kept, de-identified, and any program where you are the only director is
            archived rather than deleted.
          </Alert>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
            Delete my account
          </Button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Prefer to keep everything and just be removed from the roster? Ask your director to pause
            your membership instead — your attendance stays attributed to you.
          </p>
        </Card>
      </div>

      <ConfirmSheet
        open={confirmDelete}
        title="Delete your account?"
        body="This permanently deletes your sign-in account, removes you from all program rosters, and erases your profile details. Your past attendance stays in the records under “Deleted account.” Programs where you are the only director will be archived. This cannot be undone."
        confirmLabel="Delete account"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        Signed in to {app.program?.name ?? "this program"} as {auth.email ?? "—"}.
      </p>
    </div>
  );
}
