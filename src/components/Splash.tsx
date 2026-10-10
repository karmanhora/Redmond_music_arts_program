import { APP_NAME } from "../lib/constants";

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
    </div>
  );
}
