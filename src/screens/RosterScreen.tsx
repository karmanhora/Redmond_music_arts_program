import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  IconButton,
  Input,
  Row,
  SegmentedControl,
  Sheet,
  Skeleton,
  cn,
  useToast,
} from "../components/ui";
import { fetchRoster } from "../lib/queries";
import { deactivateMember, getJoinCode, reactivateMember, setJoinCode, setMemberSection } from "../lib/rpc";
import type { RosterMember } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { ROLE_LABEL } from "../lib/constants";
import { fmtDate } from "../lib/date";

/**
 * `/roster` — everyone in the band, grouped by section.
 *
 * Directors also run the band's join code here. It is the only way anybody gets
 * on the roster now (`invite_member` and the old password RPCs are retired): the
 * student signs up with Clerk and the `user.created` webhook checks the code
 * before it creates the profile.
 */

/** No I, O, 0 or 1 — a code gets read off a whiteboard and typed by a teenager. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function RosterScreen() {
  const app = usePrograms();
  const { toast } = useToast();
  const programId = app.program?.id ?? null;

  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"active" | "all">("active");
  const [section, setSection] = useState("all");

  const [member, setMember] = useState<RosterMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<RosterMember | null>(null);

  const [code, setCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    try {
      setError(null);
      setMembers(await fetchRoster(programId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the roster.");
      setMembers([]);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The join code is director-only; asking as anyone else just yields a refusal.
  const loadCode = useCallback(async () => {
    if (!programId || !app.isDirector) return;
    const { result, error: rpcError } = await getJoinCode(programId);
    if (rpcError || !result?.ok) {
      setCodeError(rpcError?.message || result?.message || "Could not read the join code.");
      return;
    }
    setCodeError(null);
    setCode(result.code ?? "");
  }, [programId, app.isDirector]);

  useEffect(() => {
    void loadCode();
  }, [loadCode]);

  const active = useMemo(() => (members ?? []).filter((m) => m.active), [members]);
  const inactive = useMemo(() => (members ?? []).filter((m) => !m.active), [members]);

  const sectionChoices = useMemo(() => {
    const used = new Set<string>();
    for (const m of members ?? []) if (m.section_name) used.add(m.section_name);
    return app.sections.filter((s) => used.has(s.name));
  }, [members, app.sections]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? []).filter((m) => {
      if (scope === "active" && !m.active) return false;
      if (section !== "all" && (m.section_name || "none") !== section) return false;
      if (!q) return true;
      return (
        m.profile.full_name.toLowerCase().includes(q) ||
        m.profile.display_name.toLowerCase().includes(q)
      );
    });
  }, [members, scope, section, query]);

  /** Sections in the band's canonical order, then anyone without one. */
  const groups = useMemo(() => {
    const out: { key: string; label: string; members: RosterMember[] }[] = [];
    const push = (key: string, label: string, list: RosterMember[]) => {
      if (list.length > 0) out.push({ key, label, members: list });
    };
    for (const sec of app.sections) {
      push(sec.id, sec.name, visible.filter((m) => m.section_name === sec.name));
    }
    push("none", "No section", visible.filter((m) => !m.section_name));
    return out;
  }, [visible, app.sections]);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.warn("Copying didn't work — write the code down instead.");
    }
  }

  async function replaceCode() {
    if (!programId) return;
    const next = randomCode();
    setCodeBusy(true);
    const { result, error: rpcError } = await setJoinCode(programId, next);
    setCodeBusy(false);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not change the join code.");
      return;
    }
    setCode(next);
    toast.success("New join code — tell everyone in the program before it goes in the group chat.");
  }

  async function toggleMembership(target: RosterMember, next: boolean) {
    if (!programId) return;
    setBusy(true);
    const { result, error: rpcError } = next
      ? await reactivateMember(programId, target.user_id)
      : await deactivateMember(programId, target.user_id);
    setBusy(false);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "That didn't work.");
      return;
    }
    toast.success(next ? "Back on the roster." : "Removed from the roster.");
    setMember(null);
    setConfirmDeactivate(null);
    await load();
  }

  async function moveToSection(target: RosterMember, sectionId: string | null) {
    if (!programId) return;
    setBusy(true);
    const { result, error: rpcError } = await setMemberSection(programId, target.user_id, sectionId);
    setBusy(false);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not move them.");
      return;
    }
    toast.success("Section updated.");
    setMember(null);
    await load();
  }

  if (!programId) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --- numbers --- */}
      <Card className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-extrabold tabular-nums">{members?.length ?? 0}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">on the roster</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums">{active.length}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">active</p>
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums">{sectionChoices.length}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">sections</p>
          </div>
        </div>
        {inactive.length > 0 ? (
          <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
            {inactive.length} removed {inactive.length === 1 ? "member" : "members"} — switch to
            Everyone to see them.
          </p>
        ) : null}
      </Card>

      {/* --- join code (directors) --- */}
      {app.isDirector ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-band dark:text-emerald-300" />
            <p className="font-semibold">Join code</p>
          </div>

          {codeError ? <Alert tone="error">{codeError}</Alert> : null}

          {code === null ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl bg-black/[0.05] px-3 py-3 text-center font-mono text-2xl font-extrabold tracking-[0.25em] dark:bg-white/[0.08]">
                  {code || "—"}
                </code>
                <IconButton
                  label="Copy the join code"
                  variant="secondary"
                  icon={copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  onClick={() => void copyCode()}
                  disabled={!code}
                />
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                New students type this when they create their account — it is what puts them on
                the roster. Anyone without it can sign in but sees nothing.
              </p>
              <Button
                block
                variant="secondary"
                loading={codeBusy}
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void replaceCode()}
              >
                Make a new code
              </Button>
            </>
          )}
        </Card>
      ) : null}

      {/* --- filters --- */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a member"
            aria-label="Find a member"
          />
        </div>

        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: "active", label: `Active (${active.length})` },
            { value: "all", label: `Everyone (${members?.length ?? 0})` },
          ]}
        />

        {sectionChoices.length > 1 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSection("all")}
              className={cn(
                "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors",
                section === "all"
                  ? "bg-band text-white"
                  : "bg-black/[0.05] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300"
              )}
            >
              All sections
            </button>
            {sectionChoices.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.name)}
                className={cn(
                  "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors",
                  section === s.name
                    ? "bg-band text-white"
                    : "bg-black/[0.05] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* --- the roster --- */}
      {members === null ? (
        <Skeleton className="h-64 w-full" />
      ) : members.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="The roster is empty"
            body={
              app.isDirector
                ? "Share the join code above — students appear here as soon as they sign up with it."
                : "Your director hasn't added anyone yet."
            }
          />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No one matches"
            body="Try a different name, or show everyone instead of just the active roster."
          />
        </Card>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="space-y-1">
            <div className="flex items-end justify-between px-1">
              <h2 className="text-xs font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
                {group.label}
              </h2>
              <span className="text-xs text-zinc-400">{group.members.length}</span>
            </div>
            <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
              {group.members.map((m) => {
                const name = m.profile.display_name || m.profile.full_name;
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => setMember(m)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                      !m.active && "opacity-55"
                    )}
                  >
                    <Avatar name={name} url={m.profile.avatar_url} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{name}</span>
                      <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                        {m.roles.map((r) => ROLE_LABEL[r]).join(" · ") || ROLE_LABEL.student}
                        {!m.active ? " · removed" : ""}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                  </button>
                );
              })}
            </Card>
          </div>
        ))
      )}

      {/* --- one member --- */}
      <Sheet
        open={member !== null}
        onClose={() => setMember(null)}
        title={member ? member.profile.display_name || member.profile.full_name : "Member"}
        description={member?.section_name || "No section"}
        size="tall"
      >
        {member ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar
                name={member.profile.display_name || member.profile.full_name}
                url={member.profile.avatar_url}
                size={56}
              />
              <div className="min-w-0">
                <p className="truncate font-bold">{member.profile.full_name}</p>
                {member.profile.display_name ? (
                  <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                    Goes by {member.profile.display_name}
                  </p>
                ) : null}
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Joined {fmtDate(new Date(member.joined_at))}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {member.roles.map((r) => (
                <Badge key={r} className="bg-band/12 text-band-deep dark:bg-band/25 dark:text-emerald-200">
                  {ROLE_LABEL[r]}
                </Badge>
              ))}
              {!member.active ? (
                <Badge className="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  Removed from the roster
                </Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                  Active
                </Badge>
              )}
            </div>

            {app.isDirector ? (
              <>
                <div className="space-y-1">
                  <p className="px-1 text-xs font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
                    Section
                  </p>
                  <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
                    {app.sections.map((s) => (
                      <Row
                        key={s.id}
                        title={s.name}
                        trailing={
                          member.section_id === s.id ? (
                            <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                          ) : null
                        }
                        onClick={
                          busy || member.section_id === s.id
                            ? undefined
                            : () => void moveToSection(member, s.id)
                        }
                      />
                    ))}
                    <Row
                      title="No section"
                      subtitle="They'll show up under everyone else"
                      trailing={
                        member.section_id === null ? (
                          <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                        ) : null
                      }
                      onClick={
                        busy || member.section_id === null
                          ? undefined
                          : () => void moveToSection(member, null)
                      }
                    />
                  </Card>
                </div>

                <div className="space-y-2">
                  {member.active ? (
                    <Button
                      block
                      variant="danger"
                      icon={<Archive className="h-4 w-4" />}
                      onClick={() => setConfirmDeactivate(member)}
                    >
                      Remove from the roster
                    </Button>
                  ) : (
                    <Button
                      block
                      loading={busy}
                      icon={<ArchiveRestore className="h-4 w-4" />}
                      onClick={() => void toggleMembership(member, true)}
                    >
                      Put them back on the roster
                    </Button>
                  )}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Removing keeps their attendance history and blocks sign-in. Putting them back
                    restores everything — nothing is deleted.
                  </p>
                </div>
              </>
            ) : (
              <Alert tone="info">
                Only a director can change someone&rsquo;s section or remove them from the roster.
              </Alert>
            )}
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={confirmDeactivate !== null}
        title="Remove from the roster?"
        body={`${
          confirmDeactivate?.profile.display_name || confirmDeactivate?.profile.full_name || "They"
        } won't be able to sign in or check in any more. Their attendance history stays.`}
        confirmLabel="Remove"
        loading={busy}
        onCancel={() => setConfirmDeactivate(null)}
        onConfirm={() =>
          confirmDeactivate ? void toggleMembership(confirmDeactivate, false) : undefined
        }
      />
    </div>
  );
}
