import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClerk, useUser } from "@clerk/clerk-react";
import {
  Check,
  Clock,
  LogOut,
  Moon,
  Music,
  Pencil,
  RefreshCw,
  Sun,
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
  Field,
  Input,
  ProgressRing,
  Row,
  SectionTitle,
  Sheet,
  Skeleton,
  Toggle,
  cn,
  useToast,
} from "../components/ui";
import { updateMyProfile } from "../lib/queries";
import { getMyAttendancePct, getMyAttendanceTrend, setMemberSection } from "../lib/rpc";
import type { MyAttendanceRow } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { useDark } from "../hooks/useDark";
import {
  APP_NAME,
  ATTENDANCE_STATUS_CHIP,
  ATTENDANCE_STATUS_LABEL,
  ORG_NAME,
  ROLE_LABEL,
} from "../lib/constants";
import { fmtDate, relativeDay } from "../lib/date";

/**
 * `/me` — who you are, how your own attendance is doing, and the two settings
 * that are yours to change.
 *
 * Attendance is read through `my_attendance_pct()` / `my_attendance_trend()`,
 * the same pair the home screen's ring uses, so the numbers can't drift. Nothing
 * here needs a staff role.
 */
function verdict(pct: number): string {
  if (pct >= 80) return "You're in good standing. Keep it up.";
  if (pct >= 60) return "You're slipping — a couple of rehearsals a week adds up fast.";
  return "At risk. If something is getting in the way, talk to your director.";
}

export function ProfileScreen() {
  const app = usePrograms();
  const { dark, toggle } = useDark();
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut } = useClerk();

  const programId = app.program?.id ?? null;
  const profileId = app.profile?.id ?? null;
  const navigate = useNavigate();
  const name = app.profile?.display_name || app.profile?.full_name || "Member";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const [pct, setPct] = useState<number | null>(null);
  const [trend, setTrend] = useState<MyAttendanceRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [nameOpen, setNameOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [sectionOpen, setSectionOpen] = useState(false);
  const [busySection, setBusySection] = useState<string | null>(null);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  function openNameSheet() {
    setFullName(app.profile?.full_name ?? "");
    setDisplayName(app.profile?.display_name ?? "");
    setNameError(null);
    setNameOpen(true);
  }

  async function saveName() {
    if (!profileId) return;
    if (!fullName.trim()) {
      setNameError("Your name can't be empty.");
      return;
    }
    setSavingName(true);
    const { error: writeError } = await updateMyProfile(profileId, {
      full_name: fullName.trim(),
      display_name: displayName.trim(),
    });
    setSavingName(false);
    if (writeError) {
      setNameError(writeError.message);
      return;
    }
    setNameOpen(false);
    toast.success("Saved.");
    await app.refresh();
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
    await signOut();
    setSigningOut(false);
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --- who you are --- */}
      <Card className="space-y-3">
        <div className="flex items-center gap-4">
          <Avatar name={name} url={app.profile?.avatar_url} size={64} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg leading-tight font-extrabold">{name}</p>
            {app.profile?.full_name && app.profile.full_name !== name ? (
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {app.profile.full_name}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge className="bg-band/12 text-band-deep dark:bg-band/25 dark:text-emerald-200">
                {ROLE_LABEL[app.primaryRole]}
              </Badge>
              {app.membership?.section?.name ? (
                <Badge className="bg-black/[0.06] text-zinc-700 dark:bg-white/[0.10] dark:text-zinc-200">
                  {app.membership.section.name}
                </Badge>
              ) : (
                <Badge className="bg-black/[0.06] text-zinc-700 dark:bg-white/[0.10] dark:text-zinc-200">
                  No section
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<Pencil className="h-4 w-4" />}
            onClick={openNameSheet}
          >
            Edit
          </Button>
        </div>

        <dl className="grid grid-cols-1 gap-1 border-t border-black/5 pt-3 text-sm dark:border-white/10">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-zinc-500 dark:text-zinc-400">Program</dt>
            <dd className="truncate font-medium">{app.program?.name ?? APP_NAME}</dd>
          </div>
          {app.membership?.joined_at ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-500 dark:text-zinc-400">On the roster since</dt>
              <dd className="font-medium">{fmtDate(new Date(app.membership.joined_at))}</dd>
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
                subtitle={here ? "You're looking at this one" : "Tap to switch to it"}
                trailing={
                  here ? <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" /> : null
                }
                onClick={here ? undefined : () => app.setProgram(m.ensemble.id)}
              />
            );
          })}
          <Row
            icon={<UserPlus className="h-5 w-5" />}
            title="Join another program"
            subtitle="Use the join code from that program's director"
            onClick={() => navigate("/join")}
          />
        </Card>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          {ORG_NAME}. Roles, sections and colours follow whichever program you are in.
        </p>
      </div>

      {app.profile?.must_change_password ? (
        <Alert tone="info">
          Your director set a temporary password for this account. It does nothing on its own now —
          sign in with your own login and the flag clears.
        </Alert>
      ) : null}

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
                      <Badge className={cn("shrink-0", ATTENDANCE_STATUS_CHIP[row.status])}>
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
        <SectionTitle className="pt-1">Settings</SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          <Row
            icon={dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            title="Dark mode"
            subtitle={dark ? "On — easier at night" : "Off — follows your phone"}
            trailing={<Toggle checked={dark} onChange={toggle} label="Dark mode" />}
          />
        </Card>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          {APP_NAME} keeps every program&rsquo;s schedule, check-ins and attendance in one place.
          If something looks wrong, tell your director — they can fix it.
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

      {/* --- edit my name --- */}
      <Sheet
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title="Your name"
        description="Your director sees this on the roster and in attendance."
        footer={
          <>
            <Button variant="secondary" block onClick={() => setNameOpen(false)} disabled={savingName}>
              Cancel
            </Button>
            <Button block loading={savingName} onClick={() => void saveName()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {nameError ? <Alert tone="error">{nameError}</Alert> : null}
          <Field label="Full name">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Rivera"
              autoComplete="name"
            />
          </Field>
          <Field label="What you go by" hint="Optional — what the app shows everywhere.">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alex"
            />
          </Field>
        </div>
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
