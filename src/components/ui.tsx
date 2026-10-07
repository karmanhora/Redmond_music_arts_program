/**
 * The app's UI kit.
 *
 * Everything is built for a phone first: 44px minimum tap targets, a bottom
 * sheet instead of a desktop modal, no `window.confirm`, and visible focus rings
 * plus aria labels on every control. Screens should compose these primitives
 * rather than hand-rolling markup, so spacing and colour stay consistent.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { initials } from "../lib/date";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-band text-white hover:bg-band-deep active:bg-band-deep",
  accent:
    "bg-accent text-[var(--cue-gold-ink)] hover:brightness-95 active:brightness-90",
  secondary:
    "border border-[var(--cue-border)] bg-[var(--cue-panel)] text-[var(--cue-ink)] hover:bg-[var(--cue-raised)]",
  ghost:
    "bg-transparent text-[var(--cue-ink)] hover:bg-[var(--cue-raised)]",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "min-h-11 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-14 px-5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "motion-press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && "w-full",
        className
      )}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  className,
  variant = "ghost",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  /** Same names as `Button` — one vocabulary for both controls. */
  variant?: Variant;
}) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn(
        "motion-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)]",
        VARIANT_CLASS[variant],
        className
      )}
    >
      {icon}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "cue-card rounded-[var(--radius-panel)] p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3 border-b border-[var(--cue-border)] pb-2", className)}>
      <h2 className="font-display text-lg leading-none font-bold tracking-wide text-[var(--cue-muted)] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Row({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <>
      {icon ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing}
    </>
  );

  if (!onClick) {
    return <div className={cn("flex items-center gap-3 py-3", className)}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "motion-press flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-3 text-left hover:bg-[var(--cue-raised)]",
        className
      )}
    >
      {content}
    </button>
  );
}

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-sm px-2 py-1 text-xs font-bold tracking-wide",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "success" | "warn" | "error";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info:
      "bg-[var(--cue-raised)] text-[var(--cue-ink)] ring-[var(--cue-border)]",
    success:
      "bg-emerald-50 text-emerald-950 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-900",
    warn:
      "bg-amber-50 text-amber-950 ring-amber-300 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-800",
    error:
      "bg-red-50 text-red-950 ring-red-200 dark:bg-red-950/50 dark:text-red-100 dark:ring-red-900",
  } as const;
  const Icon = { info: Info, success: CheckCircle2, warn: TriangleAlert, error: XCircle }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm",
        tones[tone],
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

const CONTROL_CLASS =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--cue-border)] bg-[var(--cue-panel)] px-3.5 py-2.5 text-base text-[var(--cue-ink)] " +
  "placeholder:text-[var(--cue-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cue-focus)]";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label ? (
        <span className="mb-1.5 block text-sm font-semibold text-[var(--cue-ink)]">
          {label}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="mt-1 block text-sm font-medium text-[var(--cue-late)]">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL_CLASS, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL_CLASS, "min-h-24", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(CONTROL_CLASS, "appearance-none pr-9", className)}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "motion-press relative h-11 w-14 shrink-0 rounded-full bg-[var(--cue-raised)]",
        checked ? "bg-band" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-3 left-1 h-5 w-5 rounded-full bg-[var(--cue-panel)] shadow-sm transition-transform duration-150",
          checked && "translate-x-6"
        )}
      />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex gap-1 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--cue-raised)] p-1",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "motion-press relative min-h-11 flex-1 rounded-[var(--radius-control)] px-3 text-sm font-semibold whitespace-nowrap",
              active
                ? "text-[var(--cue-ink)]"
                : "text-[var(--cue-muted)] hover:text-[var(--cue-ink)]"
            )}
          >
            {/* One pill per tab: it settles in/out with opacity + scale, so
                wrapped rows stay aligned and focus never moves. */}
            <span
              aria-hidden="true"
              className={cn(
                "cue-seg-pill absolute inset-0 rounded-[var(--radius-control)] bg-[var(--cue-panel)] shadow-sm",
                active && "cue-seg-pill--on"
              )}
            />
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-[var(--radius-control)]",
        className
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
          {icon}
        </span>
      ) : null}
      <p className="font-semibold">{title}</p>
      {body ? <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ProgressRing({
  value,
  size = 72,
  stroke = 8,
  children,
  className,
  animateValue = false,
}: {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
  animateValue?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  const good = clamped >= 80;
  const warn = clamped >= 60;
  return (
    <div
      role="img"
      aria-label={`${Math.round(clamped)}%`}
      className={cn("cue-ring-arrive relative inline-flex items-center justify-center", className)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--cue-border)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          stroke={good ? "var(--cue-green)" : warn ? "var(--cue-gold)" : "var(--cue-late)"}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <span className="font-display text-2xl font-bold tabular-nums">
            {animateValue ? <AnimatedPercent value={Math.round(clamped)} /> : `${Math.round(clamped)}%`}
          </span>
        )}
      </div>
    </div>
  );
}

function AnimatedPercent({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    const startValue = previousValue.current;
    previousValue.current = value;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setDisplayValue(value);
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 420);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayValue(Math.round(startValue + (value - startValue) * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <>{displayValue}%</>;
}

export function Avatar({
  name,
  url,
  size = 40,
  className,
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-black/10", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-band/15 font-bold text-band-deep dark:bg-band/25 dark:text-emerald-200",
        className
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

type ToastTone = "info" | "success" | "warn" | "error";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<{ push: (tone: ToastTone, message: string) => void } | null>(
  null
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, tone, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm animate-in">
            <Alert tone={t.tone}>{t.message}</Alert>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export interface ToastApi {
  info: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * `const { toast } = useToast();` then `toast.success("Saved.")` — one handle
 * with four tones. Every screen uses that shape, so the hook returns exactly it.
 */
export function useToast(): { toast: ToastApi } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  const toast = useMemo<ToastApi>(
    () => ({
      info: (m) => ctx.push("info", m),
      success: (m) => ctx.push("success", m),
      warn: (m) => ctx.push("warn", m),
      error: (m) => ctx.push("error", m),
    }),
    [ctx]
  );
  return { toast };
}

/* -------------------------------------------------------------------------- */
/* Sheets                                                                     */
/* -------------------------------------------------------------------------- */

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "auto",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "tall" for full-height content (the roster picker, event form). */
  size?: "auto" | "tall";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; at: number } | null>(null);
  const [dragY, setDragY] = useState(0);
  const [sheetEntering, setSheetEntering] = useState(false);

  useEffect(() => {
    if (!open) {
      setSheetEntering(false);
      setDragY(0);
      return;
    }
    setSheetEntering(true);
    const timeout = window.setTimeout(() => setSheetEntering(false), 260);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const t = window.setTimeout(() => {
      const target = panel.current?.querySelector<HTMLElement>(
        "[data-autofocus],input,select,textarea,button"
      );
      target?.focus();
    }, 30);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/55"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "cue-card relative flex w-full max-w-lg flex-col rounded-t-[var(--radius-sheet)]",
          sheetEntering && "animate-sheet",
          "sheet-drag max-h-[92vh] sm:rounded-[var(--radius-sheet)]",
          size === "tall" ? "h-[92vh]" : ""
        )}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        <div className="flex items-start gap-3 border-b border-[var(--cue-border)] p-4">
          <div
            aria-hidden="true"
            className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 touch-none rounded-full bg-[var(--cue-muted)]/50 sm:hidden"
            onPointerDown={(event) => {
              dragStart.current = { y: event.clientY, at: performance.now() };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragStart.current) return;
              setDragY(Math.max(0, event.clientY - dragStart.current.y));
            }}
            onPointerUp={(event) => {
              const start = dragStart.current;
              if (start) {
                const distance = event.clientY - start.y;
                const velocity = distance / Math.max(1, performance.now() - start.at);
                dragStart.current = null;
                if (distance > 120 || velocity > 0.65) onClose();
              }
              setDragY(0);
            }}
            onPointerCancel={() => {
              dragStart.current = null;
              setDragY(0);
            }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-2xl font-bold tracking-wide">{title}</h3>
            {description ? (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
            ) : null}
          </div>
          <IconButton label="Close" icon={<X className="h-5 w-5" />} onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer ? (
          <div className="safe-b flex gap-2 border-t border-black/5 p-4 dark:border-white/10">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  tone?: Variant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" block onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} block onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{body}</p>
    </Sheet>
  );
}
