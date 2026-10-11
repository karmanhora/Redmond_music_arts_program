import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  History,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
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
  Field,
  Input,
  Row,
  SectionTitle,
  SegmentedControl,
  Sheet,
  Skeleton,
  Textarea,
  cn,
  useToast,
} from "../components/ui";
import { CapabilityList, RoleBadges } from "../components/CapabilityList";
import { fetchRoleAssignments, fetchRoster } from "../lib/queries";
import {
  assignRole,
  createCustomRole,
  deleteCustomRole,
  listProgramRoles,
  listRoleAudit,
  revokeRole,
  updateCustomRole,
} from "../lib/rpc";
import { DELEGABLE_PERMISSIONS, PERMISSION_CATEGORY_LABEL, permissionLabel } from "../lib/permissions";
import type { PermissionCategory } from "../lib/permissions";
import { titleCase } from "../lib/constants";
import { relativeDay } from "../lib/date";
import type { Role, RoleAssignmentRow, RoleAuditEntry, RoleDefinition, RosterMember } from "../lib/types";
import { usePrograms } from "../hooks/usePrograms";

/**
 * `/roles` — who may do what, and who hands it out.
 *
 * Every control here is a thin wrapper over a SECURITY DEFINER RPC: the screen
 * decides what to *show*, the database decides what actually happens. A role the
 * caller could not delegate is rendered disabled with the reason, but the same
 * request made by hand is refused server-side (and the guard triggers refuse it
 * even if the RPC were bypassed), so hiding buttons is never the boundary.
 *
 * Reachable only with `roles.view` (the route gate enforces that); assigning and
 * revoking additionally need `roles.assign` / `roles.revoke`.
 */

/** Plain-English consequences, so a sensitive grant is never a surprise. */
const IMPACT: [string, string][] = [
  ["attendance.view_analytics", "Can see program attendance analytics and trends"],
  ["attendance.manage_roster", "Can add, pause and reactivate members, and move sections"],
  ["attendance.mark_present", "Can mark attendance for any member"],
  ["attendance.mark_section", "Can mark attendance for their own section only"],
  ["attendance.edit_records", "Can correct or excuse attendance records"],
  ["attendance.manage_events", "Can create and edit events"],
  ["attendance.view_staff_notes", "Can read the private notes staff write on records"],
  ["roles.view", "Can see roles and who holds them"],
  ["roles.assign", "Can hand out roles themselves"],
  ["roles.revoke", "Can remove roles from members"],
  ["program.manage_settings", "Can change program settings and the join code"],
  ["profile.manage_users", "Can correct other members' profile details"],
];

export function RolesScreen() {
  const app = usePrograms();
  const { toast } = useToast();
  const programId = app.program?.id ?? null;

  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignmentRow[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [audit, setAudit] = useState<RoleAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RosterMember | null>(null);
  const [builderFor, setBuilderFor] = useState<RoleDefinition | null | "new">(null);

  const load = useCallback(async () => {
    if (!programId) return;
    setError(null);

    const rolesResponse = await listProgramRoles(programId);
    if (!rolesResponse.result?.ok) {
      setError(rolesResponse.error?.message || rolesResponse.result?.message || "Could not load roles.");
      setRoster([]);
      return;
    }
    setRoles(rolesResponse.result.roles ?? []);

    const [rosterRows, assignmentRows, auditResponse] = await Promise.all([
      fetchRoster(programId),
      fetchRoleAssignments(programId),
      listRoleAudit(programId, 30),
    ]);
    setRoster(rosterRows);
    setAssignments(assignmentRows);
    setAudit(auditResponse.result?.ok ? (auditResponse.result.entries ?? []) : []);
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const customRoles = useMemo(() => roles.filter((role) => !role.is_system), [roles]);

  const filtered = useMemo(() => {
    const all = roster ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((member) => {
      const name = `${member.profile.display_name} ${member.profile.full_name}`.toLowerCase();
      return name.includes(needle) || member.section_name.toLowerCase().includes(needle);
    });
  }, [roster, query]);

  /** Capabilities the caller holds — the ceiling on what they may delegate. */
  const canDelegateEverything = useCallback(
    (role: RoleDefinition) => role.permissions.every((code) => app.permissions.includes(code as never)),
    [app.permissions]
  );

  async function doAssign(member: RosterMember, role: RoleDefinition) {
    if (!programId) return;
    const { result, error: rpcError } = await assignRole(programId, member.user_id, role.id);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not assign that role.");
      return;
    }
    toast.success(result.message || "Role assigned.");
    await Promise.all([load(), app.refresh()]);
  }

  async function doRevoke(member: RosterMember, role: RoleDefinition) {
    if (!programId) return;
    const { result, error: rpcError } = await revokeRole(programId, member.user_id, role.id);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not remove that role.");
      return;
    }
    toast.success(result.message || "Role removed.");
    await Promise.all([load(), app.refresh()]);
  }

  async function doDeleteRole(role: RoleDefinition) {
    const { result, error: rpcError } = await deleteCustomRole(role.id);
    if (rpcError || !result?.ok) {
      toast.error(rpcError?.message || result?.message || "Could not delete that role.");
      return;
    }
    toast.success(result.message || "Role deleted.");
    await Promise.all([load(), app.refresh()]);
  }

  if (roster === null && !error) {
    return (
      <div className="space-y-3 p-4 pb-6">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      <div className="space-y-1">
        <SectionTitle
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          }
        >
          Roles & permissions
        </SectionTitle>
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          {app.program?.name} · {roster?.length ?? 0} members. You can only assign roles that grant
          capabilities you hold yourself.
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* --- find a member --- */}
      <Card className="space-y-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400"
          />
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or section"
            aria-label="Search members"
            type="search"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={query ? "No matching members" : "No members yet"}
            body={query ? "Try a different name or section." : "Once people join this program they appear here."}
          />
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {filtered.map((member) => {
              const custom = assignments.filter((a) => a.user_id === member.user_id);
              const name = member.profile.display_name || member.profile.full_name;
              return (
                <li key={member.user_id}>
                  <Row
                    icon={<Avatar name={name} path={member.profile.avatar_path} url={member.profile.avatar_url} size={40} />}
                    title={name}
                    subtitle={
                      <span className="flex flex-wrap items-center gap-1.5">
                        {member.section_name ? <span>{member.section_name}</span> : <span>No section</span>}
                        {custom.length > 0 ? (
                          <Badge className="bg-accent text-[var(--cue-gold-ink)]">
                            {custom.length} custom
                          </Badge>
                        ) : null}
                        {!member.active ? (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">Paused</Badge>
                        ) : null}
                      </span>
                    }
                    trailing={<RoleBadges roles={member.roles} className="hidden max-w-48 justify-end sm:flex" />}
                    onClick={() => setSelected(member)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* --- custom roles --- */}
      <div className="space-y-1">
        <SectionTitle
          action={
            app.can("roles.assign") ? (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setBuilderFor("new")}>
                New role
              </Button>
            ) : undefined
          }
        >
          Custom roles
        </SectionTitle>
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          {customRoles.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
              None yet. A custom role is a named set of capabilities — useful when a secretary should
              see analytics, or a section leader should manage the roster, without handing over your
              own role.
            </p>
          ) : (
            customRoles.map((role) => (
              <div key={role.id} className="space-y-2 p-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{role.name}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {role.holder_count === 0
                        ? "Nobody holds this role"
                        : `${role.holder_count} ${role.holder_count === 1 ? "person holds" : "people hold"} this role`}
                      {" · "}
                      {role.scope === "section" ? "Section scope" : "Program scope"}
                    </p>
                    {role.description ? (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{role.description}</p>
                    ) : null}
                  </div>
                </div>
                <CapabilityList permissions={role.permissions} />
                {app.can("roles.assign") ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => setBuilderFor(role)}
                    >
                      Edit role
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => void doDeleteRole(role)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </Card>
      </div>

      {/* --- audit history --- */}
      <div className="space-y-1">
        <SectionTitle>Recent changes</SectionTitle>
        <Card className="p-1">
          {audit.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
              No role changes recorded yet. Every assignment, removal and custom-role edit shows up
              here with who did it.
            </p>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {audit.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-black/[0.05] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300">
                    <History className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{auditLabel(entry)}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {entry.actor_name}
                      {entry.target_name ? ` → ${entry.target_name}` : ""}
                      {entry.detail?.role ? ` · ${entry.detail.role}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-zinc-400">{relativeDay(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <MemberRolesSheet
        member={selected}
        roles={roles}
        roleById={roleById}
        assignments={assignments}
        canAssign={app.can("roles.assign")}
        canRevoke={app.can("roles.revoke")}
        canDelegateEverything={canDelegateEverything}
        onClose={() => setSelected(null)}
        onAssign={doAssign}
        onRevoke={doRevoke}
      />

      <CustomRoleSheet
        target={builderFor}
        programId={programId}
        myPermissions={app.permissions}
        onClose={() => setBuilderFor(null)}
        onSaved={async () => {
          setBuilderFor(null);
          await Promise.all([load(), app.refresh()]);
        }}
      />
    </div>
  );
}

function auditLabel(entry: RoleAuditEntry): string {
  switch (entry.action) {
    case "role.assign":
      return "Role assigned";
    case "role.revoke":
      return "Role removed";
    case "role.create":
      return "Custom role created";
    case "role.update":
      return "Custom role updated";
    case "role.delete":
      return "Custom role deleted";
    default:
      return titleCase(entry.action.replace(/[._]/g, " "));
  }
}

/* -------------------------------------------------------------------------- */
/* Member panel                                                               */
/* -------------------------------------------------------------------------- */

function MemberRolesSheet({
  member,
  roles,
  roleById,
  assignments,
  canAssign,
  canRevoke,
  canDelegateEverything,
  onClose,
  onAssign,
  onRevoke,
}: {
  member: RosterMember | null;
  roles: RoleDefinition[];
  roleById: Map<string, RoleDefinition>;
  assignments: RoleAssignmentRow[];
  canAssign: boolean;
  canRevoke: boolean;
  canDelegateEverything: (role: RoleDefinition) => boolean;
  onClose: () => void;
  onAssign: (member: RosterMember, role: RoleDefinition) => Promise<void>;
  onRevoke: (member: RosterMember, role: RoleDefinition) => Promise<void>;
}) {
  const [pending, setPending] = useState<RoleDefinition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<RoleDefinition | null>(null);

  // Reset the pending confirmation whenever the panel switches member.
  useEffect(() => {
    setPending(null);
    setConfirmRevoke(null);
  }, [member?.user_id]);

  if (!member) return null;

  const heldSystem = roles.filter((role) => role.is_system && role.key && member.roles.includes(role.key as Role));
  const heldCustomIds = new Set(assignments.filter((a) => a.user_id === member.user_id).map((a) => a.role_id));
  const heldCustom = roles.filter((role) => !role.is_system && heldCustomIds.has(role.id));
  const available = roles.filter((role) => {
    if (role.is_system && role.key === "system_admin") return false;
    if (role.is_system) return !member.roles.includes(role.key as Role);
    return !heldCustomIds.has(role.id);
  });

  const name = member.profile.display_name || member.profile.full_name;

  return (
    <>
      <Sheet
        open={Boolean(member)}
        onClose={onClose}
        title={name}
        description={`${member.section_name || "No section"} · ${roles.length} roles available in this program`}
        size="tall"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={name} path={member.profile.avatar_path} url={member.profile.avatar_url} size={56} />
            <div className="min-w-0">
              <RoleBadges roles={member.roles} />
              {member.profile.bio ? (
                <p className="mt-1 line-clamp-3 text-sm text-zinc-500 dark:text-zinc-400">{member.profile.bio}</p>
              ) : null}
            </div>
          </div>

          {/* --- roles they hold --- */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
              Current roles
            </p>
            {[...heldSystem, ...heldCustom].map((role) => (
              <Card key={role.id} className="space-y-2">
                <div className="flex items-start gap-3">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{role.name}</p>
                    {role.description ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{role.description}</p>
                    ) : null}
                  </div>
                  {canRevoke ? (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(role)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                <CapabilityList permissions={role.permissions} />
              </Card>
            ))}
          </div>

          {/* --- roles they could get --- */}
          {canAssign ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
                Assign another role
              </p>
              <ul className="divide-y divide-black/5 dark:divide-white/10">
                {available.map((role) => {
                  const allowed = canDelegateEverything(role);
                  return (
                    <li key={role.id}>
                      <Row
                        icon={
                          allowed ? (
                            <Plus className="h-5 w-5" />
                          ) : (
                            <Lock className="h-5 w-5" />
                          )
                        }
                        title={role.name}
                        subtitle={
                          allowed
                            ? role.description || `${role.permissions.length} capabilities`
                            : "Grants capabilities you don't hold yourself"
                        }
                        trailing={
                          <Button
                            size="sm"
                            variant={allowed ? "secondary" : "ghost"}
                            disabled={!allowed || busy !== null}
                            onClick={() => setPending(role)}
                          >
                            {allowed ? "Assign" : "Unavailable"}
                          </Button>
                        }
                      />
                    </li>
                  );
                })}
                {available.length === 0 ? (
                  <li className="p-3 text-sm text-zinc-500 dark:text-zinc-400">
                    {name} already holds every role available to you.
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              You can see roles but not change them. A director can grant you that.
            </p>
          )}

          <Alert tone="info">
            Role changes take effect on that person&rsquo;s next request — the database re-checks
            capabilities every time, so nothing has to be revoked from a device.
          </Alert>
        </div>
      </Sheet>

      {/* --- confirmation, with the capabilities spelled out --- */}
      <Sheet
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={pending ? `Give ${name} the ${pending.name} role?` : "Confirm"}
        description="Check what this grants before you confirm."
        footer={
          <>
            <Button variant="secondary" block onClick={() => setPending(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              block
              loading={busy === "assign"}
              onClick={() => {
                if (!pending) return;
                setBusy("assign");
                void onAssign(member, pending).finally(() => {
                  setBusy(null);
                  setPending(null);
                });
              }}
            >
              Assign role
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={name} path={member.profile.avatar_path} url={member.profile.avatar_url} size={44} />
              <div>
                <p className="font-semibold">{name}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {pending.scope === "section" ? "Applies to their section" : "Applies to the whole program"}
                </p>
              </div>
            </div>

            {pending.description ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{pending.description}</p>
            ) : null}

            <div>
              <p className="mb-1 text-[11px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
                Capabilities
              </p>
              <CapabilityList permissions={pending.permissions} />
            </div>

            {consequences(pending.permissions).length > 0 ? (
              <Alert tone="warn">
                <p className="font-semibold">This role can:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {consequences(pending.permissions).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            {roleById.get(pending.id) ? null : (
              <Alert tone="error">That role is no longer available.</Alert>
            )}
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={Boolean(confirmRevoke)}
        title={confirmRevoke ? `Remove the ${confirmRevoke.name} role from ${name}?` : "Confirm"}
        body={
          confirmRevoke
            ? `They keep everything else. ${consequences(confirmRevoke.permissions).join("; ") || "This role grants no special capabilities."}`
            : ""
        }
        confirmLabel="Remove role"
        loading={busy === "revoke"}
        onCancel={() => setConfirmRevoke(null)}
        onConfirm={() => {
          if (!confirmRevoke) return;
          setBusy("revoke");
          void onRevoke(member, confirmRevoke).finally(() => {
            setBusy(null);
            setConfirmRevoke(null);
          });
        }}
      />
    </>
  );
}

function consequences(permissions: string[]): string[] {
  return IMPACT.filter(([code]) => permissions.includes(code)).map(([, line]) => line);
}

/* -------------------------------------------------------------------------- */
/* Custom role builder                                                        */
/* -------------------------------------------------------------------------- */

function CustomRoleSheet({
  target,
  programId,
  myPermissions,
  onClose,
  onSaved,
}: {
  target: RoleDefinition | null | "new";
  /** The program a brand-new role belongs to. */
  programId: string | null;
  myPermissions: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const editing = target && target !== "new" ? target : null;
  const open = target !== null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"program" | "section">("program");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmWiden, setConfirmWiden] = useState<{ holders: number; added: string[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmWiden(null);
    if (editing) {
      setName(editing.name);
      setDescription(editing.description);
      setScope(editing.scope);
      setSelected(editing.permissions);
    } else {
      setName("");
      setDescription("");
      setScope("program");
      setSelected([]);
    }
  }, [open, editing]);

  // Only capabilities the caller holds, and only ones that may be delegated —
  // offering anything else would just produce a refusal.
  const offered = useMemo(
    () => DELEGABLE_PERMISSIONS.filter((permission) => myPermissions.includes(permission.code)),
    [myPermissions]
  );

  const grouped = useMemo(() => {
    const map = new Map<PermissionCategory, typeof offered>();
    for (const permission of offered) {
      map.set(permission.category, [...(map.get(permission.category) ?? []), permission]);
    }
    return map;
  }, [offered]);

  async function save(confirm = false) {
    if (!name.trim()) {
      setError("Give the role a name.");
      return;
    }
    if (selected.length === 0) {
      setError("Choose at least one capability.");
      return;
    }

    setSaving(true);
    setError(null);

    // A new role belongs to the program on screen; an edit belongs to whichever
    // program owns the role (the server re-derives and re-checks both).
    const response = editing
      ? await updateCustomRole(editing.id, name.trim(), description.trim(), selected, scope, confirm)
      : programId
        ? await createCustomRole(programId, name.trim(), description.trim(), selected, scope)
        : { result: { ok: false, message: "Pick a program first." }, error: null };

    setSaving(false);

    if (response.result?.needs_confirmation) {
      setConfirmWiden({ holders: response.result.holders ?? 0, added: response.result.added ?? [] });
      return;
    }
    if (response.error || !response.result?.ok) {
      setError(response.error?.message || response.result?.message || "Could not save that role.");
      return;
    }
    toast.success(response.result.message || "Role saved.");
    await onSaved();
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={editing ? `Edit ${editing.name}` : "New custom role"}
        description={
          editing
            ? `${editing.holder_count} ${editing.holder_count === 1 ? "person holds" : "people hold"} this role.`
            : "Name a set of capabilities you can delegate."
        }
        size="tall"
        footer={
          <>
            <Button variant="secondary" block onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button block loading={saving} onClick={() => void save()}>
              {editing ? "Save role" : "Create role"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : null}

          <Field label="Role name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Analytics reader" maxLength={60} />
          </Field>

          <Field label="Description" hint="One line staff will read before assigning it.">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Sees attendance analytics for the program."
              maxLength={300}
              rows={2}
            />
          </Field>

          <Field label="Scope" hint="Section scope only makes sense with section-level capabilities.">
            <SegmentedControl
              value={scope}
              onChange={setScope}
              options={[
                { value: "program", label: "Whole program" },
                { value: "section", label: "Their section" },
              ]}
            />
          </Field>

          <div className="space-y-3">
            <p className="text-[11px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
              Capabilities ({selected.length} chosen)
            </p>
            {offered.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                You don&rsquo;t hold any delegable capability, so there is nothing you can put in a
                custom role.
              </p>
            ) : (
              [...grouped.entries()].map(([category, permissions]) => (
                <div key={category}>
                  <p className="mb-1 text-sm font-semibold">{PERMISSION_CATEGORY_LABEL[category]}</p>
                  <ul className="space-y-1">
                    {permissions.map((permission) => {
                      const on = selected.includes(permission.code);
                      return (
                        <li key={permission.code}>
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setSelected((prev) =>
                                on ? prev.filter((code) => code !== permission.code) : [...prev, permission.code]
                              )
                            }
                            className={cn(
                              "motion-press flex w-full items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left",
                              on
                                ? "border-band bg-band/10 dark:border-emerald-700 dark:bg-band/20"
                                : "border-[var(--cue-border)] hover:bg-[var(--cue-raised)]"
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border",
                                on ? "border-band bg-band text-white" : "border-[var(--cue-border)]"
                              )}
                            >
                              {on ? <Check className="h-3.5 w-3.5" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{permission.label}</span>
                              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                {permission.description}
                                {permission.scope === "section" ? " (section scope)" : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>

          {!editing ? (
            <Alert tone="info">
              Capabilities that could escalate access — assigning roles, changing program settings,
              system administration — can never go into a custom role.
            </Alert>
          ) : null}
        </div>
      </Sheet>

      <ConfirmSheet
        open={Boolean(confirmWiden)}
        title="Change a role people already hold?"
        body={
          confirmWiden
            ? `${confirmWiden.holders} ${confirmWiden.holders === 1 ? "person" : "people"} hold this role and would gain: ${confirmWiden.added
                .map(permissionLabel)
                .join(", ")}. They will get it as soon as you confirm.`
            : ""
        }
        confirmLabel="Apply and grant"
        tone="primary"
        loading={saving}
        onCancel={() => setConfirmWiden(null)}
        onConfirm={() => {
          setConfirmWiden(null);
          void save(true);
        }}
      />
    </>
  );
}
