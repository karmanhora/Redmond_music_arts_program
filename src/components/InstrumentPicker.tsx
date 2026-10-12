import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "./ui";

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
        <div className="flex flex-wrap gap-1.5">
          {value.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-band/12 pr-1 pl-3 text-sm font-semibold text-band-deep dark:bg-band/25 dark:text-emerald-200"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                title={`Remove ${name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="motion-press inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-band/20 disabled:opacity-40 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No instruments yet. Add the ones this program has — students are put into their
          matching section.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
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
          className={cn(
            "min-h-11 w-full flex-1 rounded-[var(--radius-control)] border border-black/10 bg-white px-3 text-base",
            "placeholder:text-zinc-400 focus:border-band focus:outline-none",
            "disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.06] dark:text-zinc-100"
          )}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          className="motion-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-black/[0.05] px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.08]"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>
    </div>
  );
}
