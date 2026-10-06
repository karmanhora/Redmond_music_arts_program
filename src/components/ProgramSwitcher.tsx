import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, Music, UserPlus } from "lucide-react";
import { Card, Row, Sheet } from "./ui";
import { usePrograms } from "../hooks/usePrograms";
import { ORG_NAME, ROLE_LABEL } from "../lib/constants";
import type { Role } from "../lib/types";

/** The highest role somebody holds in one program, for the row's subtitle. */
function roleLabelOf(roles: Role[]): string {
  if (roles.includes("director")) return ROLE_LABEL.director;
  if (roles.includes("secretary")) return ROLE_LABEL.secretary;
  if (roles.includes("section_leader")) return ROLE_LABEL.section_leader;
  return ROLE_LABEL.student;
}

/**
 * Which program am I looking at?
 *
 * Only worth opening when there is more than one, so the app bar hides the
 * control until then — but joining a second program lives here too, so somebody
 * with a single program can still get to it from Profile.
 */
export function ProgramSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = usePrograms();
  const navigate = useNavigate();

  return (
    <Sheet open={open} onClose={onClose} title="Switch program" description={ORG_NAME} size="tall">
      <div className="space-y-3">
        <Card className="divide-y divide-black/5 p-1 dark:divide-white/10">
          {app.memberships.map((m) => {
            const here = m.ensemble.id === app.program?.id;
            const bits = [roleLabelOf(m.roles ?? []), m.section?.name].filter(Boolean).join(" · ");
            return (
              <Row
                key={m.id}
                icon={<Music className="h-5 w-5" />}
                title={m.ensemble.name}
                subtitle={here ? `You're here · ${bits}` : bits}
                trailing={
                  here ? (
                    <Check className="h-5 w-5 shrink-0 text-band dark:text-emerald-300" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" />
                  )
                }
                onClick={
                  here
                    ? undefined
                    : () => {
                        app.setProgram(m.ensemble.id);
                        onClose();
                      }
                }
              />
            );
          })}

          <Row
            icon={<UserPlus className="h-5 w-5" />}
            title="Join another program"
            subtitle="Use the join code from that program's director"
            onClick={() => {
              onClose();
              navigate("/join");
            }}
          />
        </Card>

        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          Roles, sections and colours come from the program you pick, so a director of one program is
          a student in the next.
        </p>
      </div>
    </Sheet>
  );
}
