import { Lock, ShieldCheck } from "lucide-react";
import { Badge, cn } from "./ui";
import { PERMISSION_CATEGORIES, PERMISSION_CATEGORY_LABEL, permissionMeta, permissionLabel } from "../lib/permissions";
import type { PermissionCategory } from "../lib/permissions";
import { ROLE_LABEL } from "../lib/constants";
import type { Role } from "../lib/types";

/** The role names, as badges, most senior first. */
export function RoleBadges({ roles, className }: { roles: Role[]; className?: string }) {
  const ordered = [...roles].sort(
    (a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)
  );
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {ordered.map((role) => (
        <Badge
          key={role}
          className={
            role === "director"
              ? "bg-[var(--cue-action)] text-white"
              : role === "secretary"
                ? "bg-[var(--cue-green-soft)] text-[var(--cue-green)]"
                : "bg-[var(--cue-raised)] text-[var(--cue-muted)]"
          }
        >
          {role === "director" ? <ShieldCheck aria-hidden="true" className="mr-1 h-3 w-3" /> : null}
          {ROLE_LABEL[role] ?? role}
        </Badge>
      ))}
    </div>
  );
}

const ROLE_ORDER: Role[] = ["director", "secretary", "section_leader", "student"];

/**
 * "What you can do here", written out.
 *
 * The list comes from the same capability codes the database enforces
 * (`my_permissions()`), so this describes real access rather than restating the
 * rules in a way that could drift. It is deliberately visible to the member
 * themselves: a student should be able to read what they may do, and a member
 * of staff exactly which capabilities a role handed them. A padlocked chip is a
 * capability that cannot be delegated into a custom role.
 */
export function CapabilityList({
  permissions,
  emptyMessage = "Nothing extra here — you can see your own record and check in to events.",
  className,
}: {
  permissions: string[];
  emptyMessage?: string;
  className?: string;
}) {
  const byCategory = new Map<PermissionCategory, string[]>();
  for (const code of permissions) {
    const category: PermissionCategory = permissionMeta(code)?.category ?? "system";
    byCategory.set(category, [...(byCategory.get(category) ?? []), code]);
  }

  if (byCategory.size === 0) {
    return <p className={cn("type-meta", className)}>{emptyMessage}</p>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {PERMISSION_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => (
        <div key={category}>
          <p className="type-label">
            {PERMISSION_CATEGORY_LABEL[category]}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {byCategory.get(category)!.map((code) => {
              const meta = permissionMeta(code);
              return (
                <li key={code}>
                  <Badge
                    className={cn(
                      "bg-[var(--cue-raised)] text-[var(--cue-ink)]",
                      meta && !meta.delegable &&
                        "bg-[var(--cue-late-bg)] text-[var(--cue-late)]"
                    )}
                  >
                    {meta && !meta.delegable ? <Lock aria-hidden="true" className="mr-1 h-3 w-3" /> : null}
                    {permissionLabel(code)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
