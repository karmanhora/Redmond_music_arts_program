import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Input, cn } from "./ui";

/**
 * Pick the instruments (sections) a program contains.
 *
 * Used when a director creates a program, so the students they add afterwards
 * can be dropped straight into the right section instead of everyone landing
 * under "No section". Kept deliberately simple: type one, press Add (or Enter),
 * and the chip appears. Names are trimmed, whitespace collapsed and
 * case-insensitive duplicates ignored, matching `normalize_section_name()` in
 * the database — the server re-checks and caps the list regardless.
 */
export function InstrumentPicker({
  value,
  onChange,
  disabled,
  max = 60,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (value.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    if (value.length >= max) return;
    onChange([...value, name]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((name, index) => (
            <li
              key={`${name}-${index}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-chip)] border border-[var(--cue-line-strong)] bg-[var(--cue-raised)] pr-1 pl-2.5 text-[0.8125rem] font-semibold text-[var(--cue-ink)]"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="motion-press inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-chip)] text-[var(--cue-muted)] hover:bg-[var(--cue-panel)] hover:text-[var(--cue-ink)] disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-meta">
          No instruments yet. Add the ones this program has — students are put into their matching
          section.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Input
          className={cn("flex-1")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Flute, Violin, Trumpet…"
          maxLength={40}
          disabled={disabled}
          aria-label="Add an instrument"
        />
        <Button
          type="button"
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
