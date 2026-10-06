import { useCallback, useEffect, useState } from "react";

const KEY = "rhs-band:dark";
const EVENT = "rhs-band:dark-changed";

function preferred(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* private mode — fall through to the OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function paint(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0c0f0a" : "#2d5a1b");
  // Let the browser tint form controls / scrollbars to match.
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Dark mode is a class on <html> (see index.css). Every instance listens for the
 * change event so the shell's toggle and any screen-level toggle stay in sync.
 */
export function useDark(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState<boolean>(() =>
    typeof window === "undefined" ? false : preferred()
  );

  useEffect(() => {
    paint(dark);
    const onChange = () => setDark(preferred());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [dark]);

  const toggle = useCallback(() => {
    const next = !preferred();
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      /* ignore — the class still flips for this session */
    }
    paint(next);
    window.dispatchEvent(new Event(EVENT));
    setDark(next);
  }, []);

  return { dark, toggle };
}
