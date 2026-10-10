import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./useAuth";
import { applyThemeTokens } from "../lib/theme";
import {
  fetchMyMemberships,
  fetchProfileByAuthId,
  fetchSections,
  fetchThemeTokens,
} from "../lib/queries";
import type { EmbeddedMembership } from "../lib/queries";
import type { EnsembleRow, Profile, Role, SectionRow } from "../lib/types";

/**
 * Who am I, which programs am I in, and which one am I looking at?
 *
 * The site is the Music and Arts Program; each tracker inside it is a *program*
 * (the database's word for that row is `ensemble` — it never reaches a user).
 * Roles, sections and colours belong to a program, not to a person, so every
 * flag below describes the **current** program: a student who directs one
 * program and plays in another sees each one with its own rights.
 *
 * The chosen program is remembered per person, so opening the app tomorrow shows
 * the one they last used.
 */

export type ProgramsStatus = "loading" | "ready" | "no-roster" | "error";

export interface ProgramsState {
  status: ProgramsStatus;
  error: string | null;
  /** The signed-in person's row in `profiles`. */
  profile: Profile | null;
  /** Every program this person is active in — the switcher reads this. */
  memberships: EmbeddedMembership[];
  /** The one currently on screen. */
  membership: EmbeddedMembership | null;
  /** The current tracker's own row. */
  program: EnsembleRow | null;
  sections: SectionRow[];
  roles: Role[];
  isDirector: boolean;
  isSecretary: boolean;
  isSectionLeader: boolean;
  /** Director, secretary or section leader *in the current program*. */
  isStaff: boolean;
  /** Staff somewhere, even if not here. */
  isStaffAnywhere: boolean;
  /** Highest role held in the current program, for the chip beside the name. */
  primaryRole: Role;
  setProgram: (ensembleId: string) => void;
  /**
   * Re-read the session. Pass a program id to land in *that* one instead of the
   * remembered choice — what the join and start-a-program screens use, so the
   * program somebody just added is the one on screen.
   */
  refresh: (preferEnsembleId?: string) => Promise<void>;
}

const EMPTY: Omit<ProgramsState, "refresh" | "setProgram" | "status" | "error"> = {
  profile: null,
  memberships: [],
  membership: null,
  program: null,
  sections: [],
  roles: [],
  isDirector: false,
  isSecretary: false,
  isSectionLeader: false,
  isStaff: false,
  isStaffAnywhere: false,
  primaryRole: "student",
};

/** Remembered per person, so a switch survives a reload. */
const STORAGE_PREFIX = "rhs:current-program:";

function readRemembered(profileId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + profileId);
  } catch {
    return null;
  }
}

function remember(profileId: string, ensembleId: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + profileId, ensembleId);
  } catch {
    /* private mode — the choice just doesn't survive a reload */
  }
}

const ProgramsContext = createContext<ProgramsState | null>(null);

function primaryRoleOf(roles: Role[]): Role {
  if (roles.includes("director")) return "director";
  if (roles.includes("secretary")) return "secretary";
  if (roles.includes("section_leader")) return "section_leader";
  return "student";
}

function isStaffRole(roles: Role[]): boolean {
  return (
    roles.includes("director") || roles.includes("secretary") || roles.includes("section_leader")
  );
}

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<Omit<ProgramsState, "refresh" | "setProgram">>({
    ...EMPTY,
    status: "loading",
    error: null,
  });

  const authUserId = auth.userId;
  const signedIn = auth.status === "signed-in";

  /** Load one program's sections and colours, then make it the current one. */
  const loadProgram = useCallback(
    async (profile: Profile, memberships: EmbeddedMembership[], wanted: string | null) => {
      const membership =
        memberships.find((m) => m.ensemble.id === wanted) ?? memberships[0] ?? null;

      if (!membership) {
        // Signed in, but on no roster at all: they need a join code.
        setState({ ...EMPTY, profile, status: "no-roster", error: null });
        return;
      }

      const [sections, tokens] = await Promise.all([
        fetchSections(membership.ensemble.id),
        fetchThemeTokens(membership.ensemble.id),
      ]);
      applyThemeTokens(tokens);

      // Remember whichever program we settled on, whatever brought us here, so a
      // reload shows the same one (setProgram used to be the only path that did).
      remember(profile.id, membership.ensemble.id);

      const roles = membership.roles ?? ["student"];
      setState({
        status: "ready",
        error: null,
        profile,
        memberships,
        membership,
        program: membership.ensemble,
        sections,
        roles,
        isDirector: roles.includes("director"),
        isSecretary: roles.includes("secretary"),
        isSectionLeader: roles.includes("section_leader"),
        isStaff: isStaffRole(roles),
        isStaffAnywhere: memberships.some((m) => isStaffRole(m.roles ?? [])),
        primaryRole: primaryRoleOf(roles),
      });
    },
    []
  );

  const refresh = useCallback(async (preferEnsembleId?: string) => {
    // The session is still being restored: stay on the splash rather than
    // deciding "no roster" from an answer we don't have yet.
    if (auth.status === "loading") return;
    if (!signedIn || !authUserId) {
      setState({ ...EMPTY, status: "loading", error: null });
      return;
    }

    setState((prev) => ({ ...prev, status: "loading", error: null }));

    try {
      const profile = await fetchProfileByAuthId(authUserId);
      if (!profile) {
        // Signed in, but never joined a program → no profile row yet.
        setState({ ...EMPTY, status: "no-roster", error: null });
        return;
      }

      const memberships = (await fetchMyMemberships(profile.id)).filter((m) => m.active);
      await loadProgram(profile, memberships, preferEnsembleId ?? readRemembered(profile.id));
    } catch (e) {
      setState({
        ...EMPTY,
        status: "error",
        error: e instanceof Error ? e.message : "Could not load your programs.",
      });
    }
  }, [auth.status, signedIn, authUserId, loadProgram]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Move to another program this person belongs to. Whatever is on screen stays
   * put while the next one loads, so switching never flashes a splash screen.
   */
  const setProgram = useCallback(
    (ensembleId: string) => {
      const { profile, memberships, program } = state;
      if (!profile || ensembleId === program?.id) return;
      remember(profile.id, ensembleId);
      void loadProgram(profile, memberships, ensembleId).catch((e: unknown) => {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: e instanceof Error ? e.message : "Could not switch programs.",
        }));
      });
    },
    [state, loadProgram]
  );

  const value = useMemo<ProgramsState>(
    () => ({ ...state, setProgram, refresh }),
    [state, setProgram, refresh]
  );

  return <ProgramsContext.Provider value={value}>{children}</ProgramsContext.Provider>;
}

/**
 * The signed-in session. Only valid inside `<ProgramsProvider>` — screens render
 * below it, and it throws early if that ever stops being true.
 */
export function usePrograms(): ProgramsState {
  const ctx = useContext(ProgramsContext);
  if (!ctx) throw new Error("usePrograms must be used inside <ProgramsProvider>");
  return ctx;
}
