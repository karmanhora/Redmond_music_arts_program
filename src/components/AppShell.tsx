import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronsUpDown,
  ClipboardCheck,
  Home,
  Moon,
  QrCode,
  Sun,
  User,
  Users,
} from "lucide-react";
import { fetchNotifications, markNotificationsRead } from "../lib/queries";
import type { NotificationRow } from "../lib/types";
import { APP_NAME, ORG_NAME, ROLE_LABEL } from "../lib/constants";
import { relativeDay } from "../lib/date";
import { usePrograms } from "../hooks/usePrograms";
import { useDark } from "../hooks/useDark";
import { ProgramSwitcher } from "./ProgramSwitcher";
import { Alert, Avatar, IconButton, Sheet, cn } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  need?: "staff" | "director";
}

/**
 * The bottom bar. 44px+ targets, at most five items; "Me" lives on the avatar
 * for directors so Analytics fits without a sixth tab.
 */
function navItems(opts: { isStaff: boolean; isDirector: boolean }): NavItem[] {
  const base: NavItem[] = [
    { to: "/", label: "Home", icon: Home },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
  ];
  if (opts.isStaff) {
    base.push({ to: "/attendance", label: "Attendance", icon: ClipboardCheck });
    base.push({ to: "/roster", label: "Roster", icon: Users });
    base.push(
      opts.isDirector
        ? { to: "/analytics", label: "Analytics", icon: BarChart3, need: "director" }
        : { to: "/me", label: "Me", icon: User }
    );
    return base;
  }
  base.push({ to: "/checkin", label: "Check in", icon: QrCode });
  base.push({ to: "/me", label: "Me", icon: User });
  return base;
}

export function AppShell() {
  const app = usePrograms();
  const { dark, toggle } = useDark();
  const navigate = useNavigate();
  const [bellOpen, setBellOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const items = navItems({ isStaff: app.isStaff, isDirector: app.isDirector });
  const name = app.profile?.display_name || app.profile?.full_name || "Member";
  const programName = app.program?.name ?? APP_NAME;
  const inSeveral = app.memberships.length > 1;
  const under = [ROLE_LABEL[app.primaryRole], app.membership?.section?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="app-shell flex h-full flex-col bg-[var(--cue-page)]">
      {/* --- app bar: the umbrella, then the program you are actually in --- */}
      <header className="safe-t sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--cue-border)] bg-[var(--cue-page)] px-3 py-1">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[10px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
            {ORG_NAME}
          </p>
          {inSeveral ? (
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Switch program — currently ${programName}`}
              className="motion-press -ml-1 flex min-h-11 max-w-full items-center gap-1 rounded-[var(--radius-control)] px-1 text-left hover:bg-[var(--cue-raised)]"
            >
              <span className="truncate text-sm font-bold">{programName}</span>
              <span className="hidden truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400">
                {under}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            </button>
          ) : (
            <p className="truncate text-sm font-bold">
              {programName}
              <span className="ml-1.5 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                {under}
              </span>
            </p>
          )}
        </div>
        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {items.map((item) => (
            <NavLink
              key={item.to}
              viewTransition
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "motion-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-semibold",
                  isActive
                    ? "bg-[var(--cue-raised)] text-[var(--cue-green)]"
                    : "text-[var(--cue-muted)] hover:bg-[var(--cue-raised)]"
                )
              }
            >
              <item.icon aria-hidden="true" className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <IconButton
          label="Notifications"
          onClick={() => setBellOpen(true)}
          variant="ghost"
          icon={<Bell className="h-5 w-5" />}
        />
        <IconButton
          label={dark ? "Use light mode" : "Use dark mode"}
          onClick={toggle}
          variant="ghost"
          icon={dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        />
        <Link viewTransition to="/me" aria-label="Your profile" className="motion-press shrink-0">
          <Avatar name={name} url={app.profile?.avatar_url} size={34} />
        </Link>
      </header>

      {!online ? (
        <div className="px-3 pt-2">
          <Alert tone="warn">
            You&rsquo;re offline. Anything you see may be out of date — check-in needs a
            connection.
          </Alert>
        </div>
      ) : null}

      {app.profile?.must_change_password ? (
        <div className="px-3 pt-2">
          <Alert tone="info">
            Your director issued you a temporary password.{" "}
            <button className="font-semibold underline" onClick={() => navigate("/me")}>
              Set your own
            </button>
            .
          </Alert>
        </div>
      ) : null}

      {/* --- content --- */}
      <main
        className="app-content min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <Outlet />
      </main>

      {/* --- bottom nav --- */}
      <nav
        aria-label="Main navigation"
        className="safe-b z-30 shrink-0 border-t border-[var(--cue-border)] bg-[var(--cue-page)] lg:hidden"
      >
        <ul className="flex items-stretch justify-around pt-1 pb-0.5">
          {items.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                viewTransition
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "motion-press relative mx-auto flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-none px-1 py-1 text-[10px] font-semibold",
                    isActive
                      ? "text-[var(--cue-green)]"
                      : "text-[var(--cue-muted)]"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
                    <span>{item.label}</span>
                    {isActive ? <span aria-hidden="true" className="cue-tab-indicator" /> : null}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <NotificationsSheet open={bellOpen} onClose={() => setBellOpen(false)} />
      <ProgramSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </div>
  );
}

function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);

  const load = useCallback(async () => {
    const next = await fetchNotifications();
    setRows(next);
    const unread = next.filter((n) => !n.read).map((n) => n.id);
    await markNotificationsRead(unread);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    void load();
  }, [open, load]);

  return (
    <Sheet open={open} onClose={onClose} title="Notifications" size="tall">
      {rows === null ? (
        <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          Nothing yet. New events and open check-ins show up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li
              key={n.id}
              className="rounded-xl bg-white p-3 ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{n.title}</p>
                <span className="shrink-0 text-[11px] text-zinc-400">
                  {relativeDay(n.created_at)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
