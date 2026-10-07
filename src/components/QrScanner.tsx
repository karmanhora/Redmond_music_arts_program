import { useEffect, useRef, useState } from "react";

const ELEMENT_ID = "band-qr-reader";

/**
 * Camera QR reader. `html5-qrcode` is imported lazily so the ~300 kB library
 * never lands in the initial bundle, and the camera is torn down the moment
 * `active` goes false (leaving a screen must always release the camera).
 *
 * `onDecode` MUST be wrapped in `useCallback` by the caller — a new function
 * identity restarts the camera.
 */
export function QrScanner({
  active,
  onDecode,
  onError,
}: {
  active: boolean;
  onDecode: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scanner = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastHit = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "unavailable">("starting");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setCameraState("starting");

    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !host.current) return;

        const instance = new Html5Qrcode(ELEMENT_ID, { verbose: false });
        scanner.current = instance;

        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            const now = Date.now();
            // The camera fires continuously; ignore the same code for 3s.
            if (decoded === lastHit.current.text && now - lastHit.current.at < 3000) return;
            lastHit.current = { text: decoded, at: now };
            onDecode(decoded);
          },
          () => {
            /* per-frame "no QR found" — not worth surfacing */
          }
        );
        if (!cancelled) setCameraState("ready");
      } catch (e) {
        if (!cancelled) {
          setCameraState("unavailable");
          const errorName = e instanceof DOMException ? e.name : "";
          const message =
            errorName === "NotAllowedError" || errorName === "PermissionDeniedError"
              ? "Camera access is off. Enter the code instead, or allow camera access in your browser."
              : errorName === "NotFoundError" || errorName === "NotSupportedError"
                ? "No usable camera was found. Enter the check-in code instead."
                : e instanceof Error
                  ? e.message
                  : "Camera unavailable. Enter the check-in code instead.";
          onError?.(message);
        }
      }
    })();

    return () => {
      cancelled = true;
      const instance = scanner.current;
      scanner.current = null;
      if (instance) {
        void instance
          .stop()
          .then(() => instance.clear())
          .catch(() => {
            /* already stopped */
          });
      }
    };
  }, [active, onDecode, onError]);

  return (
    <div
      id={ELEMENT_ID}
      ref={host}
      className="relative mx-auto flex min-h-56 w-full max-w-sm items-center justify-center overflow-hidden rounded-[var(--radius-panel)] border border-[var(--cue-border)] bg-[#111713] text-center text-sm text-white [&_video]:w-full"
    >
      {cameraState !== "ready" ? (
        <p className="px-6 py-8" role="status">
          {cameraState === "starting"
            ? "Opening camera…"
            : "Camera unavailable. Enter the code instead."}
        </p>
      ) : null}
    </div>
  );
}
