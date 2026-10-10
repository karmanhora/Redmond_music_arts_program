import { Alert } from "../components/ui";
import { APP_NAME } from "../lib/constants";

/**
 * Shown instead of the app when the build has no Supabase configuration. A blank
 * white page is the alternative, and this tells you exactly which variable to
 * add and where.
 */
export function ConfigMissingScreen({ missing }: { missing: string[] }) {
  return (
    <div className="safe-t flex min-h-full flex-col items-center justify-center gap-5 bg-surface p-6 dark:bg-[#0c0f0a]">
      <div className="text-center">
        <img src="/logo.svg" alt="" className="mx-auto h-14 w-14" />
        <h1 className="mt-3 text-xl font-bold">{APP_NAME}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This build is missing its configuration.
        </p>
      </div>

      <Alert tone="warn" className="w-full max-w-md">
        <p className="font-semibold">Missing:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {missing.map((m) => (
            <li key={m}>
              <code className="font-mono text-[13px]">{m}</code>
            </li>
          ))}
        </ul>
      </Alert>

      <div className="w-full max-w-md rounded-2xl bg-white p-4 text-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        <p className="font-semibold">How to fix it locally</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-zinc-600 dark:text-zinc-300">
          <li>
            Copy <code className="font-mono">.env.example</code> to{" "}
            <code className="font-mono">.env.local</code>.
          </li>
          <li>
            Fill in the Supabase URL and anon key (see{" "}
            <code className="font-mono">docs/DEV.md</code>). Those two are the whole
            frontend configuration — Supabase is both the database and the sign-in system.
          </li>
          <li>Restart the dev server — Vite only reads env files at startup.</li>
        </ol>
      </div>
    </div>
  );
}
