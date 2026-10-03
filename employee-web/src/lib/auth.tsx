import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, SESSION_KEY, clearTokens, loadTokens, saveTokens, setSessionEndedHandler, tokensFromPair } from "./api";
import { clearActiveCall } from "./callFlow";
import { api } from "./endpoints";
import { newId } from "./ids";
import type { ClientConfig, DeviceInfoPayload, Employee } from "./types";

export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "1.0.0";

/** "Chrome on Windows" - shown to administrators next to the session. */
export function describeBrowser(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return `Web app (${browser}${os ? ` on ${os}` : ""})`;
}

const DEVICE_KEY = "ec_web_device";

function browserId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${newId()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "web-private-window";
  }
}

/** platform "webapp" tells the backend this is the browser version of the phone app: no device is registered for it. */
export function deviceInfo(): DeviceInfoPayload {
  return { device_uid: browserId(), name: describeBrowser(navigator.userAgent), platform: "webapp", app_version: APP_VERSION };
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "unreachable" }
  | { status: "signedIn"; employee: Employee; config: ClientConfig };

interface AuthContextValue {
  state: AuthState;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** reload the profile (the unread-notification count and the server's settings live there) */
  refreshMe: () => Promise<void>;
  markPasswordChanged: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function noticeFor(reason: string): string | undefined {
  if (reason === "account_disabled") return "Your account has been deactivated. Contact your administrator.";
  if (reason === "session_ended") return "Your session has ended. Please sign in again.";
  return undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const boot = useCallback(async () => {
    if (!loadTokens()) {
      setState({ status: "signedOut" });
      return;
    }
    setState({ status: "loading" });
    try {
      const me = await api.me();
      setState({ status: "signedIn", employee: me.employee, config: me.config });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearTokens();
        setState({ status: "signedOut", notice: noticeFor(error.code === "account_disabled" ? "account_disabled" : "session_ended") });
      } else {
        setState({ status: "unreachable" });
      }
    }
  }, []);

  useEffect(() => {
    setSessionEndedHandler((reason) => {
      queryClient.clear();
      clearActiveCall();
      setState({ status: "signedOut", notice: noticeFor(reason) });
    });
    return () => setSessionEndedHandler(null);
  }, [queryClient]);

  useEffect(() => {
    void boot(); // the one-time start-up check: is there a saved session, and is it still good?
  }, [boot]);

  // Several tabs share one session: signing out in one signs out the others, and signing in in one signs in the others.
  const status = useRef(state.status);
  useEffect(() => {
    status.current = state.status;
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SESSION_KEY) return; // null = the whole storage was cleared
      if (loadTokens()) {
        if (status.current === "signedOut") void boot();
      } else if (status.current === "signedIn") {
        queryClient.clear();
        clearActiveCall();
        setState({ status: "signedOut" });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [boot, queryClient]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const pair = await api.login(identifier.trim(), password, deviceInfo());
      saveTokens(tokensFromPair(pair));
      try {
        const me = await api.me();
        queryClient.clear();
        setState({ status: "signedIn", employee: me.employee, config: me.config });
      } catch (error) {
        clearTokens();
        throw error;
      }
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the session is dropped on this browser either way */
    }
    clearTokens();
    clearActiveCall();
    queryClient.clear();
    setState({ status: "signedOut" });
  }, [queryClient]);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.me();
      setState((current) => (current.status === "signedIn" ? { status: "signedIn", employee: me.employee, config: me.config } : current));
    } catch {
      /* a failed refresh keeps what is shown */
    }
  }, []);

  const markPasswordChanged = useCallback(() => {
    setState((current) => (current.status === "signedIn" ? { ...current, employee: { ...current.employee, must_change_password: false } } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, refreshMe, markPasswordChanged, retry: () => void boot() }),
    [state, signIn, signOut, refreshMe, markPasswordChanged, boot],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in employee and the server's settings. Only for pages behind the sign-in guard. */
export function useSession(): { employee: Employee; config: ClientConfig } {
  const { state } = useAuth();
  if (state.status !== "signedIn") throw new Error("useSession needs a signed-in user");
  return { employee: state.employee, config: state.config };
}
