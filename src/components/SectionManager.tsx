import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  ConfirmSheet,
  IconButton,
  Input,
  Row,
  Sheet,
  useToast,
} from "./ui";
import { addProgramSection, removeProgramSection, renameProgramSection } from "../lib/rpc";
import { usePrograms } from "../hooks/usePrograms";
import type { SectionRow } from "../lib/types";

/**
 * A program's instruments, managed. The director names them when the program is
 * created, and this is where they fix a typo, add an instrument that arrived
 * late, or drop one that is gone. Removing a section never removes a person —
 * `remove_program_section()` sets their section to null, so they simply fall
 * under "No section" until they are moved.
 *
 * Only rendered for a director: every call is gated again on the server by
 * `can_manage_ensemble()`.
 */
export function SectionManager() {
  const app = usePrograms();
  const { toast } = useToast();
  const programId = app.program?.id ?? null;

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState<SectionRow | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  if (!programId) return null;

  async function add() {
    if (!programId || !draft.trim()) return;
    setAdding(true);
    const { result, error } = await addProgramSection(programId, draft);
    setAdding(false);
    if (error || !result?.ok) {
      toast.error(error?.message || result?.message || "Could not add that instrument.");
      return;
    }
    setDraft("");
    toast.success(result.name ? `${result.name} added.` : "Instrument added.");
    await app.reloadSections();
  }

  async function rename() {
    if (!editing || !renameValue.trim()) return;
    setRenaming(true);
    const { result, error } = await renameProgramSection(editing.id, renameValue);
    setRenaming(false);
    if (error || !result?.ok) {
      toast.error(error?.message || result?.message || "Could not rename that section.");
      return;
    }
    setEditing(null);
    toast.success("Section renamed.");
    await app.reloadSections();
  }

  async function remove() {
    if (!removing) return;
    setRemovingBusy(true);
    const { result, error } = await removeProgramSection(removing.id);
    setRemovingBusy(false);
    if (error || !result?.ok) {
      toast.error(error?.message || result?.message || "Could not remove that section.");
      return;
    }
    const moved = result.moved_to_no_section ?? 0;
    setRemoving(null);
    toast.success(
      moved > 0
        ? `${removing.name} removed — ${moved} ${
            moved === 1 ? "member is" : "members are"
          } now under "No section".`
        : `${removing.name} removed.`
    );
    await app.reloadSections();
  }

  return (
    <>
      <Card className="space-y-3">
        <p className="type-meta">
          Everyone in a section is grouped together on the roster and in attendance. Removing a
          section keeps its members — they just show under &ldquo;No section&rdquo;.
        </p>

        {app.sections.length === 0 ? (
          <p className="type-meta">No sections yet. Add your first instrument below.</p>
        ) : (
          <div className="cue-list overflow-hidden rounded-[var(--radius-panel)] border border-[var(--cue-line)]">
            {app.sections.map((section) => (
              <Row
                key={section.id}
                title={section.name}
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={`Rename ${section.name}`}
                      variant="ghost"
                      className="h-9 w-9"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => {
                        setEditing(section);
                        setRenameValue(section.name);
                      }}
                    />
                    <IconButton
                      label={`Remove ${section.name}`}
                      variant="ghost"
                      className="h-9 w-9"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setRemoving(section)}
                    />
                  </span>
                }
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="Add an instrument — e.g. Viola"
            maxLength={40}
            disabled={adding}
            aria-label="New instrument name"
          />
          <Button
            type="button"
            variant="secondary"
            icon={<Plus className="h-4 w-4" />}
            loading={adding}
            disabled={!draft.trim()}
            onClick={() => void add()}
          >
            Add
          </Button>
        </div>
      </Card>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Rename section"
        description="Whoever is in it stays in it."
      >
        <div className="space-y-3">
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void rename();
              }
            }}
            maxLength={40}
            aria-label="Section name"
          />
          <Button block loading={renaming} disabled={!renameValue.trim()} onClick={() => void rename()}>
            Save name
          </Button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={removing !== null}
        title="Remove this section?"
        body={`${removing?.name ?? "This section"} will be removed from the program. Anybody in it stays on the roster and moves to "No section".`}
        confirmLabel="Remove section"
        loading={removingBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
