import { useState } from "react";
import { APP_NAME } from "../lib/constants";
import { pickMusicQuote } from "../lib/quotes";
import { cn } from "./ui";

export function MusicLoader() {
  return (
    <div className="music-loader" role="status" aria-label="Loading">
      {Array.from({ length: 3 }, (_, index) => (
        <span key={index} className="music-loader-icon" aria-hidden="true">
          <svg viewBox="0 0 100 100" fill="currentColor">
            <ellipse
              transform="rotate(-21.283 49.994 75.642)"
              cx="50"
              cy="75.651"
              rx="19.347"
              ry="16.432"
            />
            <path d="M58.474 7.5h10.258v63.568H58.474z" />
          </svg>
        </span>
      ))}
    </div>
  );
}

/**
 * A musical line to read while something loads, one per mount.
 *
 * Picked once, in a state initialiser, rather than on every render: a quote
 * that reshuffles while you are reading it is worse than no quote at all. A
 * new mount is a new line — so a route change on the loading skeleton shows a
 * different one, which is the closest thing to "random" that does not move
 * text under a reader's eyes. `min-h-20` reserves two lines plus the
 * attribution, so switching between a short line and a long one does not jog
 * the logo above it.
 *
 * No animation: it is text on a loading screen, and the loader beside it is
 * already moving. It therefore needs no reduced-motion branch of its own.
 */
export function LoadingQuote({
  tone = "onBrand",
  className,
}: {
  /** `onBrand` sits on the green splash; `onPage` sits on the app's own page. */
  tone?: "onBrand" | "onPage";
  className?: string;
}) {
  const [quote] = useState(() => pickMusicQuote());
  const onBrand = tone === "onBrand";

  return (
    <figure className={cn("mt-2 min-h-20 w-full max-w-sm", className)}>
      <blockquote
        className={cn(
          "text-sm leading-relaxed",
          onBrand ? "text-white/85" : "text-[var(--cue-muted)]"
        )}
      >
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      {/* `.type-kicker` sets its own colour from an unlayered rule, so the
          utility needs `!` to take effect — same as the landing page's gold
          kicker on the green hero. */}
      <figcaption
        className={cn(
          "type-kicker mt-2",
          onBrand ? "text-[var(--cue-gold-on-brand)]!" : "text-[var(--cue-leaf)]!"
        )}
      >
        {quote.author}
      </figcaption>
    </figure>
  );
}

/** Brand-tinted splash used while we resolve the Supabase Auth session or the roster. */
export function Splash({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="safe-t flex h-full flex-col items-center justify-center gap-4 bg-band px-8 text-center text-white">
      <img src="/logo.svg" alt="" className="h-16 w-16 opacity-95" />
      <div>
        <p className="text-lg font-bold">{APP_NAME}</p>
        <p className="mt-1 text-sm text-white/70">{label}</p>
      </div>
      <MusicLoader />
      <LoadingQuote />
    </div>
  );
}
