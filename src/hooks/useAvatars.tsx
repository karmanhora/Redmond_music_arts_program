import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { cachedAvatarUrl, signAvatarPaths } from "../lib/avatar";

/**
 * Turns stored avatar *paths* into displayable signed URLs, one request per
 * screen.
 *
 * The bucket is private (030), so a picture has no permanent URL. Every distinct
 * path is requested once, batched on the next microtask, signed for an hour and
 * cached — so a 40-person roster is a single round-trip, and returning to a
 * screen re-uses the cache instead of re-signing. Paths the viewer may not read
 * simply never resolve and the avatar falls back to initials.
 *
 * Outside the provider (there is nowhere like that today, but `Avatar` is a UI
 * primitive) nothing is signed and the component falls back to its `url` prop.
 */
interface AvatarUrlState {
  request: (paths: string[]) => void;
  urls: Record<string, string>;
}

const AvatarUrlContext = createContext<AvatarUrlState | null>(null);

export function AvatarUrlProvider({ children }: { children: ReactNode }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const queue = useRef<Set<string>>(new Set());
  const timer = useRef<number | null>(null);
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      // Drain in the order paths were requested; a path added *during* the
      // request stays queued for the next pass.
      const paths = [...queue.current];
      queue.current.clear();
      if (paths.length === 0) return;
      const resolved = await signAvatarPaths(paths);
      if (Object.keys(resolved).length > 0) {
        setUrls((prev) => ({ ...prev, ...resolved }));
      }
    } finally {
      flushing.current = false;
      if (queue.current.size > 0 && timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void flush();
        }, 0);
      }
    }
  }, []);

  const request = useCallback(
    (paths: string[]) => {
      let added = false;
      for (const path of paths) {
        if (!path) continue;
        if (queue.current.has(path)) continue;
        if (cachedAvatarUrl(path)) continue;
        queue.current.add(path);
        added = true;
      }
      if (!added) return;
      if (timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void flush();
        }, 0);
      }
    },
    [flush]
  );

  const value = useMemo<AvatarUrlState>(() => ({ request, urls }), [request, urls]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return <AvatarUrlContext.Provider value={value}>{children}</AvatarUrlContext.Provider>;
}

/**
 * The signed URL for one stored path, or null while it is being resolved (or
 * when the viewer is not allowed to read it).
 */
export function useSignedAvatarUrl(path: string | null | undefined): string | null {
  const ctx = useContext(AvatarUrlContext);
  const known = path ? (ctx?.urls[path] ?? cachedAvatarUrl(path)) : null;

  useEffect(() => {
    if (!path || !ctx) return;
    if (cachedAvatarUrl(path)) return;
    ctx.request([path]);
  }, [path, ctx]);

  return known;
}
