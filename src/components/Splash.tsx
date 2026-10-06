import { Spinner } from "./ui";
import { APP_NAME } from "../lib/constants";

/** Brand-tinted splash used while we resolve the Clerk session or the roster. */
export function Splash({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="safe-t flex h-full flex-col items-center justify-center gap-4 bg-band px-8 text-center text-white">
      <img src="/logo-dark.svg" alt="" className="h-16 w-16 opacity-95" />
      <div>
        <p className="text-lg font-bold">{APP_NAME}</p>
        <p className="mt-1 text-sm text-white/70">{label}</p>
      </div>
      <Spinner className="h-6 w-6 text-white/80" />
    </div>
  );
}
