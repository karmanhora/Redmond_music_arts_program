import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Clock,
  KeyRound,
  LogOut,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserCog,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ProgressRing,
  Row,
  SectionTitle,
  Sheet,
  Skeleton,
  useToast,
} from "../components/ui";
import { ProfileForm } from "../components/ProfileForm";
import { CapabilityList, RoleBadges } from "../components/CapabilityList";
import {
  getMyAttendancePct,
  getMyAttendanceTrend,
  setMemberSection,
  setProgramActive,
} from "../lib/rpc";
import type { MyAttendanceRow } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { useAuth } from "../hooks/useAuth";
import { APP_NAME, ATTENDANCE_STATUS_CHIP, ATTENDANCE_STATUS_LABEL, ORG_NAME } from "../lib/constants";
import { fmtDate, relativeDay } from "../lib/date";

/**
 * `/me` — who you are, what you are allowed to do here, how your own attendance
 * is doing, and the way into everything else that is yours to change.
 *
 * Attendance is read through `my_attendance_pct()` / `my_attendance_trend()`,
 * the same pair the home screen's ring uses, so the numbers can't drift. Nothing
 * here needs a staff role.
 *
 * Editing your own name, biography and picture is the one write this screen
 * makes, and it goes through `profiles` under RLS — roles, sections and program
 * membership are *not* editable here (see `CapabilityList`, which shows why).
 */
function verdict(pct: number): string {
  if (pct >= 80) return "You're in good standing. Keep it up.";
  if (pct >= 60) return "You're slipping — a couple of rehearsals a week adds up fast.";
  return "At risk. If something is getting in the way, talk to your director.";
}

export function ProfileScreen() {
  const app = usePrograms();
  const auth = useAuth();
  const { toast } = useToast();

  const programId = app.program?.id ?? null;
  const profileId = app.profile?.id ?? null;
  const navigate = useNavigate();
  const name = app.profile?.display_name || app.profile?.full_name || "Member";
  const email = auth.email;

  const [pct, setPct] = useState<number | null>(null);
  const [trend, setTrend] = useState<MyAttendanceRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [busySection, setBusySection] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmProgramArchive, setConfirmProgramArchive] = useState(false);
  const [updatingProgramStatus, setUpdatingProgramStatus] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    setError(null);
    const [pctResponse, trendResponse] = await Promise.all([
      getMyAttendancePct(programId),
      getMyAttendanceTrend(programId, 8),
    ]);

    if (pctResponse.error) {
      setError(pctResponse.error.message);
    } else if (pctResponse.result?.ok && typeof pctResponse.result.percentage === "number") {
      setPct(pctResponse.result.percentage);
    } else {
      setPct(null);
    }

    setRefusal(
      !pctResponse.result?.ok && pctResponse.result?.message
        ? pctResponse.result.message
        : trendResponse.message
    );
    setTrend(trendResponse.rows);
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeProgramStatus() {
    if (!programId || !app.isDirector || !app.program) return;
    setUpdatingProgramStatus(true);
    const { result, error: rpcError } = await setProgramActive(programId, !app.program.active);
    setUpdatingProgramStatus(false);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not update this program.");
      return;
    }
    setConfirmProgramArchive(false);
    toast.success(result.message || (app.program.active ? "Program archived." : "Program restored."));
    await app.refresh(programId);
  }

  async function moveToSection(sectionId: string | null) {
    if (!programId || !profileId) return;
    setBusySection(sectionId ?? "none");
    const { result, error: rpcError } = await setMemberSection(programId, profileId, sectionId);
    setBusySection(null);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not change your section.");
      return;
    }
    setSectionOpen(false);
    toast.success("Section updated.");
    await app.refresh();
  }

  async function doSignOut() {
    setSigningOut(true);
    await auth.signOut();
    setSigningOut(false);
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --- who you are --- */}
      <Card className="space-y-3">
        <div className="flex items-center gap-4">
          <Avatar
            name={name}
            path={app.profile?.avatar_path}
            url={app.profile?.avatar_url}
            size={64}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg leading-tight font-extrabold">{name}</p>
            {app.profile?.full_name && app.profile.full_name !== name ? (
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {app.profile.full_name}
              </p>
            ) : null}
            <RoleBadges roles={app.roles} className="mt-1.5" />
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Pencil className="h-4 w-4" />}
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
        </div>

        {app.profile?.bio ? (
          <p className="border-t border-black/5 pt-3 text-sm text-zinc-600 dark:border-white/10 dark:text-zinc-300">
            {app.profile.bio}
          </p>
        ) : null}

        <dl className="grid grid-cols-1 gap-1 border-t border-black/5 pt-3 text-sm dark:border-white/10">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">Program</dt>
            <dd className="truncate font-medium">{app.program?.name ?? APP_NAME}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">Section</dt>
            <dd className="truncate font-medium">{app.membership?.section?.name || "None yet"}</dd>
          </div>
          {app.membership?.joined_at ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">On the roster since</dt>
              <dd className="font-medium">{fmtDate(new Date(app.membership.joined_at))}</dd>
            </div>
          ) : null}
          {app.profile?.created_at ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Account created</dt>
              <dd className="font-medium">{fmtDate(new Date(app.profile.created_at))}</dd>
            </div>
          ) : null}
          {email ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">Signed in as</dt>
              <dd className="min-w-0 truncate font-medium">{email}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {app.profile?.must_change_password ? (
        <Alert tone="info">
          Your director set a temporary password for this account.{" "}
          <button className="font-semibold underline" onClick={() => navigate("/settings")}>
            Choose your own
          </button>{" "}
          and this note clears.
        </Alert>
      ) : null}

      {/* --- what I may do here --- */}
      <div className="space-y-1">
        <SectionTitle>Roles & permissions</SectionTitle>
        <Card className="space-y-3">
          <CapabilityList permissions={app.permissions} />
          <p className="border-t border-black/5 pt-3 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            These come from your roles in {app.program?.name ?? "this program"} and are checked again
            on the server for every action. A padlocked item can only come with a role, never from a
            custom one.
          </p>
        </Card>
      </div>

      {/* --- the programs I belong to --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">My programs</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          {app.memberships.map((m) => {
            const here = m.ensemble.id === app.program?.id;
            return (
              <Row
                key={m.id}
                icon={<Music className="h-5 w-5" />}
                title={m.ensemble.name}
                subtitle={
                  !m.ensemble.active
                    ? "Archived"
                    : here
                      ? "You're looking at this one"
                      : "Tap to switch to it"
                }
                trailing={
                  here ? <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" /> : null
                }
                onClick={here ? undefined : () => app.setProgram(m.ensemble.id)}
              />
            );
          })}
          {app.isDirector && app.program ? (
            <Row
              icon={
                app.program.active ? (
                  <Archive className="h-5 w-5" />
                ) : (
                  <ArchiveRestore className="h-5 w-5" />
                )
              }
              title={app.program.active ? "Archive this program" : "Restore this program"}
              subtitle={
                app.program.active
                  ? "Hide it from new members; keep existing members and attendance."
                  : "Make it available for new members to join again."
              }
              onClick={() => setConfirmProgramArchive(true)}
            />
          ) : null}
          <Row
            icon={<UserPlus className="h-5 w-5" />}
            title="Join another program"
            subtitle="Use the join code from that program's director"
            onClick={() => navigate("/join")}
          />
          {app.canCreateProgram ? (
            <Row
              icon={<Plus className="h-5 w-5" />}
              title="Start a new program"
              subtitle="Name it and you're its director"
              onClick={() => navigate("/new-program")}
            />
          ) : null}
        </Card>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          {ORG_NAME}. Roles, sections and colours follow whichever program you are in.
        </p>
      </div>

      {/* --- my attendance --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">My attendance</SectionTitle>
        {refusal ? (
          <Card>
            <EmptyState icon={<UserRound className="h-6 w-6" />} title="Not available" body={refusal} />
          </Card>
        ) : loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Card className="space-y-3">
            <div className="flex items-center gap-4">
              <ProgressRing value={pct ?? 0} size={76} stroke={8} />
              <div className="min-w-0">
                {pct === null ? (
                  <>
                    <p className="font-semibold">No required events yet</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Your percentage appears after your first required rehearsal or game.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Required events attended</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{verdict(pct)}</p>
                  </>
                )}
              </div>
            </div>

            {trend.length > 0 ? (
              <div className="space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                {trend.map((row) => (
                  <Row
                    key={row.id}
                    icon={<Clock className="h-5 w-5" />}
                    title={row.name}
                    subtitle={relativeDay(row.date)}
                    trailing={
                      <Badge className={ATTENDANCE_STATUS_CHIP[row.status]}>
                        {ATTENDANCE_STATUS_LABEL[row.status]}
                      </Badge>
                    }
                  />
                ))}
                <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Excused absences are left out of your percentage.
                </p>
              </div>
            ) : null}
          </Card>
        )}
      </div>

      {/* --- my section --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">My section</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={<UserRound className="h-5 w-5" />}
            title={app.membership?.section?.name || "No section yet"}
            subtitle="Tap to change where you sit in the program"
            onClick={() => setSectionOpen(true)}
          />
        </Card>
      </div>

      {/* --- settings --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">Settings & access</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={<Settings className="h-5 w-5" />}
            title="Account settings"
            subtitle="Name, picture, password, email, appearance"
            trailing={<ChevronRight aria-hidden="true" className="h-4 w-4 text-zinc-400" />}
            onClick={() => navigate("/settings")}
          />
          <Row
            icon={<KeyRound className="h-5 w-5" />}
            title="Password & sign-in"
            subtitle="Change your password, confirm your email"
            trailing={<ChevronRight aria-hidden="true" className="h-4 w-4 text-zinc-400" />}
            onClick={() => navigate("/settings")}
          />
          {app.can("roles.view") ? (
            <Row
              icon={<UserCog className="h-5 w-5" />}
              title="Roles & permissions"
              subtitle="Assign roles and build custom ones for this program"
              trailing={<ChevronRight aria-hidden="true" className="h-4 w-4 text-zinc-400" />}
              onClick={() => navigate("/roles")}
            />
          ) : null}
        </Card>
      </div>

      {/* --- the public notices, one tap away --- */}
      <div className="space-y-1">
        <SectionTitle className="pt-1">Privacy</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Privacy Policy"
            subtitle="What is collected, who can see it, and how to request deletion"
            onClick={() => navigate("/privacy")}
          />
        </Card>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          Deleting your account, and what is kept afterwards, lives in Account settings →
          Privacy.
        </p>
      </div>

      <Button
        block
        variant="secondary"
        icon={<LogOut className="h-4 w-4" />}
        onClick={() => setConfirmSignOut(true)}
      >
        Sign out
      </Button>

      {/* --- edit profile --- */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit your profile"
        description="Your director and your program see your name and picture."
        size="tall"
      >
        {app.profile ? (
          <ProfileForm
            profile={app.profile}
            authUserId={auth.userId ?? ""}
            onSaved={() => app.refresh()}
          />
        ) : null}
      </Sheet>

      {/* --- pick my section --- */}
      <Sheet
        open={sectionOpen}
        onClose={() => setSectionOpen(false)}
        title="My section"
        description="Your director can move you too."
        size="tall"
      >
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          {app.sections.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
              Your director hasn&rsquo;t set up sections yet.
            </p>
          ) : (
            app.sections.map((s) => (
              <Row
                key={s.id}
                title={s.name}
                trailing={
                  app.membership?.section_id === s.id ? (
                    <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                  ) : busySection === s.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-zinc-400" />
                  ) : null
                }
                onClick={
                  busySection !== null || app.membership?.section_id === s.id
                    ? undefined
                    : () => void moveToSection(s.id)
                }
              />
            ))
          )}
          <Row
            title="No section"
            subtitle="You'll show up under everyone else"
            trailing={
              app.membership?.section_id === null ? (
                <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
              ) : busySection === "none" ? (
                <RefreshCw className="h-4 w-4 animate-spin text-zinc-400" />
              ) : null
            }
            onClick={
              busySection !== null || app.membership?.section_id === null
                ? undefined
                : () => void moveToSection(null)
            }
          />
        </Card>
      </Sheet>

      <ConfirmSheet
        open={confirmProgramArchive}
        title={app.program?.active ? "Archive this program?" : "Restore this program?"}
        body={
          app.program?.active
            ? "New members will no longer be able to join. Current members, events, and attendance history will be kept. You can restore the program later."
            : "This will make the program available for new members to join again. Existing members and attendance history are unchanged."
        }
        confirmLabel={app.program?.active ? "Archive program" : "Restore program"}
        tone={app.program?.active ? "danger" : "primary"}
        loading={updatingProgramStatus}
        onCancel={() => setConfirmProgramArchive(false)}
        onConfirm={() => void changeProgramStatus()}
      />
      <ConfirmSheet
        open={confirmSignOut}
        title="Sign out?"
        body="You'll need your login again to check in. Nothing on the roster changes."
        confirmLabel="Sign out"
        loading={signingOut}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => void doSignOut()}
      />
    </div>
  );
}
