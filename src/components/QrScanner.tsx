import { useEffect, useRef, useState } from "react";

const ELEMENT_ID = "band-qr-reader";

function cameraErrorMessage(error: unknown): string {
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "Camera scanning requires a secure HTTPS connection. Open the public school attendance website and allow camera access.";
  }

  const errorName = error instanceof DOMException ? error.name : "";
  switch (errorName) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera access is blocked. Allow camera access for this website in your browser or phone settings, then try again.";
    case "NotFoundError":
    case "NotSupportedError":
      return "No usable camera was found. Enter the check-in code instead.";
    case "NotReadableError":
      return "The camera is busy in another app. Close other camera apps and try again.";
    case "OverconstrainedError":
      return "The rear camera could not be opened. Try again or enter the check-in code instead.";
    default:
      return "The camera could not start. Check this website’s camera permission, then try again or enter the check-in code.";
  }
}

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
  const teardown = useRef<Promise<void>>(Promise.resolve());
  const lastHit = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [cameraState, setCameraState] = useState<"starting" | "ready" | "unavailable">("starting");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let instance: import("html5-qrcode").Html5Qrcode | null = null;
    setCameraState("starting");

    const previousTeardown = teardown.current;
    const start = (async () => {
      await previousTeardown;
      if (cancelled || !host.current) return;

      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled || !host.current) return;

      instance = new Html5Qrcode(ELEMENT_ID, { verbose: false });

      await instance.start(
        { facingMode: { ideal: "environment" } },
        {
          fps: 10,
          qrbox: (width, height) => {
            const edge = Math.floor(Math.min(width, height) * 0.72);
            return { width: Math.min(edge, 320), height: Math.min(edge, 320) };
          },
        },
        (decoded) => {
          const now = Date.now();
          // The camera fires continuously; ignore the same code for 3s.
          if (decoded === lastHit.current.text && now - lastHit.current.at < 3000) return;
          lastHit.current = { text: decoded, at: now };
          onDecode(decoded);
        },
        () => {
          /* Per-frame "no QR found" is expected while the camera is searching. */
        }
      );

      if (!cancelled) setCameraState("ready");
    })();

    void start.catch((error: unknown) => {
      if (!cancelled) {
        setCameraState("unavailable");
        onError?.(cameraErrorMessage(error));
      }
    });

    return () => {
      cancelled = true;
      teardown.current = (async () => {
        await start.catch(() => undefined);
        if (!instance) return;
        if (instance.isScanning) await instance.stop();
        instance.clear();
      })().catch((error: unknown) => {
        console.error("Could not stop the QR scanner cleanly.", error);
      });
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
