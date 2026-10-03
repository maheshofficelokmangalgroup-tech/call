import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth, useSession } from "@/lib/auth";
import { useQueue } from "@/lib/queries";
import { colors } from "@/lib/theme";

import { EmptyState } from "./EmptyState";
import { Splash } from "./Splash";
import { TabBar, TABS } from "./TabBar";
import { Text } from "./Text";
import { ToastHost } from "./ToastHost";

/** Pages that take over the whole screen: no navigation, so the outcome of a call cannot be skipped by accident. */
const FOCUS_PATHS = ["/outcome/", "/incall/"];
const TAB_PATHS = TABS.map((tab) => tab.path);

const TITLES: Record<string, string> = {
  "/": "Home",
  "/queue": "My calls",
  "/dial": "Dial",
  "/history": "Call history",
  "/profile": "Profile",
  "/callbacks": "Callbacks",
  "/notifications": "Notifications",
  "/change-password": "Change password",
};

/** The signed-in layout: navigation, the page and the toasts. */
export function AppShell() {
  const { pathname } = useLocation();
  const { employee } = useSession();
  const { refreshMe } = useAuth();
  const queue = useQueue();

  // the unread count and the server's settings come with the profile: look again every minute and whenever the tab is shown
  useEffect(() => {
    const id = setInterval(() => void refreshMe(), 60_000);
    const onVisible = () => document.visibilityState === "visible" && void refreshMe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshMe]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const title = TITLES[pathname];
    document.title = title ? `${title} - Employee Calling` : "Employee Calling";
  }, [pathname]);

  const forcedPassword = pathname === "/change-password" && employee.must_change_password;
  const focus = forcedPassword || FOCUS_PATHS.some((p) => pathname.startsWith(p));
  const onTab = TAB_PATHS.includes(pathname);

  return (
    <div className="shell" data-focus={focus || undefined} data-stack={!onTab || undefined}>
      {focus ? null : <TabBar due={queue.data?.dueCallbacks ?? 0} name={employee.full_name} code={employee.employee_code} />}
      <main className="shell-main">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}

/** Keeps signed-out visitors out, and sends people with a temporary password to choose their own. */
export function RequireAuth() {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <Splash />;
  if (state.status === "unreachable") {
    return (
      <div className="splash">
        <EmptyState icon="wifi-off" title="Cannot reach the server" message="Check your internet connection. Your session is safe - try again in a moment." actionLabel="Try again" onAction={retry} tone={colors.orange} toneSoft={colors.orangeSoft} />
      </div>
    );
  }
  if (state.status === "signedOut") {
    const next = location.pathname === "/" ? "" : `?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  if (state.employee.must_change_password && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  return <AppShell />;
}

export function NotFound() {
  return (
    <div className="page">
      <EmptyState icon="search" title="Page not found" message="This page does not exist (any more)." actionLabel="Go home" onAction={() => window.location.assign("/")} />
      <Text variant="caption" color="faint" align="center">
        {window.location.pathname}
      </Text>
    </div>
  );
}
