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
  accent: "bg-accent text-ink hover:brightness-95 active:brightness-90",
  secondary:
    "bg-white text-ink ring-1 ring-black/10 hover:bg-black/[0.03] dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10 dark:hover:bg-zinc-800",
  ghost:
    "bg-transparent text-ink hover:bg-black/[0.05] dark:text-zinc-200 dark:hover:bg-white/[0.08]",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-13 px-5 text-base",
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
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
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
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
        "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5",
        "dark:bg-zinc-900 dark:ring-white/10",
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
    <div className={cn("flex items-end justify-between gap-3 px-1", className)}>
      <h2 className="text-xs font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
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
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-band/10 text-band dark:bg-band/20 dark:text-emerald-300">
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
        "flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
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
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide",
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
    info: "bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-100 dark:ring-sky-900",
    success:
      "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-100 dark:ring-emerald-900",
    warn: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-100 dark:ring-amber-900",
    error: "bg-red-50 text-red-900 ring-red-200 dark:bg-red-950/50 dark:text-red-100 dark:ring-red-900",
  } as const;
  const Icon = { info: Info, success: CheckCircle2, warn: TriangleAlert, error: XCircle }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm ring-1",
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
  "w-full rounded-xl border-0 bg-white px-3.5 py-3 text-base text-ink ring-1 ring-black/10 " +
  "placeholder:text-zinc-400 focus:ring-2 focus:ring-band dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/15";

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
        <span className="mb-1.5 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {label}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">{error}</span>
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
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        checked ? "bg-band" : "bg-zinc-300 dark:bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-6" : "left-1"
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
        "flex gap-1 overflow-x-auto rounded-xl bg-black/[0.05] p-1 dark:bg-white/[0.06]",
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-9 flex-1 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors",
            o.value === value
              ? "bg-white text-ink shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-600 hover:text-ink dark:text-zinc-400 dark:hover:text-zinc-100"
          )}
        >
          {o.label}
        </button>
      ))}
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
        "animate-pulse rounded-xl bg-black/[0.06] dark:bg-white/[0.08]",
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
}: {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  const good = clamped >= 80;
  const warn = clamped >= 60;
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-black/10 dark:stroke-white/15"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className={good ? "stroke-band" : warn ? "stroke-accent" : "stroke-red-500"}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <span className="text-sm font-bold">{Math.round(clamped)}%</span>
        )}
      </div>
    </div>
  );
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
        "flex shrink-0 items-center justify-center rounded-full bg-band/15 font-bold text-band-deep dark:bg-band/25 dark:text-emerald-200",
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
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex w-full max-w-lg flex-col rounded-t-3xl bg-surface shadow-2xl ring-1 ring-black/10",
          "dark:bg-zinc-950 dark:ring-white/10 sm:rounded-3xl",
          "animate-sheet max-h-[92vh]",
          size === "tall" ? "h-[92vh]" : ""
        )}
      >
        <div className="flex items-start gap-3 border-b border-black/5 p-4 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold">{title}</h3>
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
