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
  UserPlus,
  Users,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  Input,
  List,
  PageHeader,
  Row,
  SectionTitle,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  cn,
  useToast,
} from "../components/ui";
import { fetchRoster } from "../lib/queries";
import { SectionManager } from "../components/SectionManager";
import {
  getJoinCode,
  inviteProgramStudent,
  reactivateMember,
  removeMember,
  setJoinCode,
  setMemberSection,
} from "../lib/rpc";
import type { RosterMember } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";
import { ROLE_LABEL } from "../lib/constants";
import { fmtDate } from "../lib/date";

/**
 * `/roster` — everyone in the program, grouped by section.
 *
 * The page's job is finding a person and acting on them, so the list owns the
 * page: invitation, the join code and the instrument list are tools, and tools
 * live behind a button until they are needed.
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
  const [confirmRemove, setConfirmRemove] = useState<RosterMember | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

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

  /** Sections in the program's canonical order, then anyone without one. */
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

  async function sendInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!programId) return;
    setInviting(true);
    setInviteError(null);
    const { message, error: inviteFailure } = await inviteProgramStudent(
      programId,
      inviteEmail,
      inviteName
    );
    setInviting(false);
    if (inviteFailure) {
      setInviteError(inviteFailure);
      return;
    }
    setInviteName("");
    setInviteEmail("");
    setInviteOpen(false);
    toast.success(message ?? "Invitation sent.");
  }

  async function toggleMembership(target: RosterMember, next: boolean) {
    if (!programId) return;
    setBusy(true);
    const { result, error: rpcError } = next
      ? await reactivateMember(programId, target.user_id)
      : await removeMember(programId, target.user_id);
    setBusy(false);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "That didn't work.");
      return;
    }
    toast.success(next ? "Back on the roster." : "Removed from the program.");
    setMember(null);
    setConfirmRemove(null);
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
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-5 sm:px-6">
        <Skeleton className="h-16 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 pb-10 sm:px-6 sm:py-6">
      <div className="cue-stagger space-y-5">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <PageHeader
          kicker={app.program?.short_name || app.program?.name || "Program"}
          title="Roster"
          note={[
            `${active.length} active`,
            inactive.length > 0 ? `${inactive.length} removed` : null,
            app.sections.length > 0
              ? `${app.sections.length} ${app.sections.length === 1 ? "section" : "sections"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          actions={
            <>
              {app.isDirector ? (
                <Button
                  variant="secondary"
                  icon={<KeyRound className="h-4 w-4" />}
                  onClick={() => setCodeOpen(true)}
                >
                  Join code
                </Button>
              ) : null}
              {app.isStaff ? (
                <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
                  Invite a student
                </Button>
              ) : null}
            </>
          }
        />

        {/* --- filters --- */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[10rem] flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--cue-subtle)]"
              />
              <Input
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a member"
                aria-label="Find a member"
              />
            </div>
            {sectionChoices.length > 1 ? (
              <Select
                aria-label="Filter by section"
                className="w-auto min-w-[9rem] flex-none"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="all">All sections</option>
                {sectionChoices.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>

          {inactive.length > 0 ? (
            <SegmentedControl
              value={scope}
              onChange={setScope}
              options={[
                { value: "active", label: `Active ${active.length}` },
                { value: "all", label: `Everyone ${members?.length ?? 0}` },
              ]}
            />
          ) : null}
        </div>

        {/* --- the roster --- */}
        {members === null ? (
          <Skeleton className="h-64 w-full" />
        ) : members.length === 0 ? (
          <div className="cue-card rounded-[var(--radius-panel)]">
            <EmptyState
              icon={<Users className="h-4 w-4" />}
              title="The roster is empty"
              body={
                app.isDirector
                  ? "Share the join code — students appear here as soon as they use it. Or invite them by email and they are added when they accept."
                  : "Nobody has been added to this program yet."
              }
              action={
                app.isDirector ? (
                  <Button variant="secondary" onClick={() => setCodeOpen(true)}>
                    Show the join code
                  </Button>
                ) : null
              }
            />
          </div>
        ) : groups.length === 0 ? (
          <div className="cue-card rounded-[var(--radius-panel)]">
            <EmptyState
              icon={<Search className="h-4 w-4" />}
              title="No one matches"
              body="Try a different name, another section, or include the people who have been removed."
            />
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.key}>
                <SectionTitle
                  className="mb-2"
                  action={<span className="type-meta tabular">{group.members.length}</span>}
                >
                  {group.label}
                </SectionTitle>
                <List>
                  {group.members.map((m) => {
                    const name = m.profile.display_name || m.profile.full_name;
                    return (
                      <Row
                        key={m.user_id}
                        className={cn("gap-3", !m.active && "opacity-60")}
                        leading={
                          <Avatar
                            name={name}
                            path={m.profile.avatar_path}
                            url={m.profile.avatar_url}
                            size={32}
                          />
                        }
                        title={name}
                        subtitle={[
                          m.roles.map((r) => ROLE_LABEL[r]).join(" · ") || ROLE_LABEL.student,
                          !m.active ? "removed" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        trailing={
                          <ChevronRight
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-[var(--cue-subtle)]"
                          />
                        }
                        onClick={() => setMember(m)}
                      />
                    );
                  })}
                </List>
              </section>
            ))}
          </div>
        )}

        {/* --- instruments & sections (directors) --- */}
        {app.isDirector ? (
          <section>
            <SectionTitle className="mb-2">Instruments &amp; sections</SectionTitle>
            <SectionManager />
          </section>
        ) : null}
      </div>

      {/* --- invite a student --- */}
      <Sheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a student"
        description="They are added to this roster after they accept and confirm their email."
      >
        <form className="space-y-4" onSubmit={(event) => void sendInvitation(event)}>
          {inviteError ? <Alert tone="error">{inviteError}</Alert> : null}
          <p className="type-meta">
            Invitations are for people who have no account yet. For someone who already has one, send
            them the join code instead.
          </p>
          <Field label="Student name">
            <Input
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              placeholder="Alex Rivera"
              autoComplete="name"
              required
              maxLength={80}
            />
          </Field>
          <Field label="Student email">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="student@example.edu"
              autoComplete="email"
              required
            />
          </Field>
          <Button
            block
            type="submit"
            loading={inviting}
            disabled={!inviteName.trim() || !inviteEmail.trim()}
          >
            Send invitation
          </Button>
        </form>
      </Sheet>

      {/* --- join code --- */}
      <Sheet
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        title="Join code"
        description="Someone who has signed up types this to get onto the roster."
      >
        <div className="space-y-4">
          {codeError ? <Alert tone="error">{codeError}</Alert> : null}

          {code === null ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-[var(--cue-line-strong)] bg-[var(--cue-raised)] px-3 py-3 text-center font-mono text-2xl font-semibold tracking-[0.25em]">
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
              <p className="type-meta">
                Without it, somebody can sign in and still see nothing — the code is what puts them
                on this program&rsquo;s roster.
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
              <p className="type-meta">
                A new code stops working for anyone who has not used the old one yet.
              </p>
            </>
          )}
        </div>
      </Sheet>

      {/* --- one member --- */}
      <Sheet
        open={member !== null}
        onClose={() => setMember(null)}
        title={member ? member.profile.display_name || member.profile.full_name : "Member"}
        description={member?.section_name || "No section"}
        size="tall"
      >
        {member ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar
                name={member.profile.display_name || member.profile.full_name}
                path={member.profile.avatar_path}
                url={member.profile.avatar_url}
                size={52}
              />
              <div className="min-w-0">
                <p className="type-heading truncate">{member.profile.full_name}</p>
                {member.profile.display_name ? (
                  <p className="type-meta truncate">Goes by {member.profile.display_name}</p>
                ) : null}
                <p className="type-meta">Joined {fmtDate(new Date(member.joined_at))}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {member.roles.map((r) => (
                <Badge
                  key={r}
                  className="bg-[var(--cue-green-soft)] text-[var(--cue-green)]"
                >
                  {ROLE_LABEL[r]}
                </Badge>
              ))}
              {!member.active ? (
                <Badge className="bg-[var(--cue-raised)] text-[var(--cue-muted)]">
                  Removed from the roster
                </Badge>
              ) : (
                <Badge className="bg-[var(--cue-present-bg)] text-[var(--cue-present)]">Active</Badge>
              )}
            </div>

            {app.isDirector ? (
              <>
                <div>
                  <SectionTitle className="mb-2">Section</SectionTitle>
                  <List>
                    {app.sections.map((s) => (
                      <Row
                        key={s.id}
                        title={s.name}
                        trailing={
                          member.section_id === s.id ? (
                            <Check
                              aria-hidden="true"
                              className="h-5 w-5 shrink-0 text-[var(--cue-green)]"
                            />
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
                      subtitle="They show up under everyone else"
                      trailing={
                        member.section_id === null ? (
                          <Check
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0 text-[var(--cue-green)]"
                          />
                        ) : null
                      }
                      onClick={
                        busy || member.section_id === null
                          ? undefined
                          : () => void moveToSection(member, null)
                      }
                    />
                  </List>
                </div>

                <div className="space-y-2">
                  {member.active ? (
                    <Button
                      block
                      variant="danger"
                      icon={<Archive className="h-4 w-4" />}
                      onClick={() => setConfirmRemove(member)}
                    >
                      Remove from the program
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
                  <p className="type-meta">
                    Removing takes them off this program completely — their section, any custom roles
                    and their attendance here are deleted. Their account is kept, so the join code
                    can put them back.
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
        open={confirmRemove !== null}
        title="Remove from the program?"
        body={`${
          confirmRemove?.profile.display_name || confirmRemove?.profile.full_name || "They"
        } will be taken off this roster completely: their place, any custom roles and their
        attendance in this program are deleted. Their account is kept. This cannot be undone.`}
        confirmLabel="Remove completely"
        loading={busy}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => (confirmRemove ? void toggleMembership(confirmRemove, false) : undefined)}
      />
    </div>
  );
}
