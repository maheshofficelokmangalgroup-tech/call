import { create } from 'zustand';

import { DEFAULT_API_URL } from '../config/env';
import { clearServerCache, initDatabase } from '../database/db';
import { getCache, getKv, setCache, setKv } from '../database/kvCache';
import { api } from '../services/api/endpoints';
import {
  ApiError,
  getBaseUrl,
  normalizeServerUrl,
  setBaseUrl,
  setSessionEndedHandler,
  tokensFromPair,
} from '../services/api/client';
import type { ClientConfig, Employee, Me } from '../services/api/types';
import { serverUrlProblem } from '../services/api/serverUrl';
import { syncEngine } from '../services/sync/syncEngine';
import { clearTokens, loadTokens, saveTokens } from '../services/storage/secureTokens';
import { telephony } from '../services/telephony/native';

export type AuthStatus = 'booting' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  employee: Employee | null;
  config: ClientConfig | null;
  serverUrl: string;
  /** shown on the login screen after a forced sign-out ("Your session has ended...") */
  notice: string | null;

  boot: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setServerUrl: (url: string) => Promise<void>;
  markPasswordChanged: () => void;
  clearNotice: () => void;
}

const KV_SERVER_URL = 'server_url';
const CACHE_ME = 'me';

async function deviceForLogin() {
  if (!telephony.isAvailable()) return null;
  try {
    const d = await telephony.getDeviceInfo();
    return {
      device_uid: d.deviceUid,
      name: `${d.manufacturer} ${d.model}`.trim(),
      platform: 'android',
      os_version: d.osVersion,
      app_version: d.appVersion,
    };
  } catch {
    return null;
  }
}

const MESSAGES: Record<string, string> = {
  session_ended: 'Your session has ended. Please sign in again.',
  account_disabled: 'Your account has been deactivated. Contact your administrator.',
  signed_out: 'Please sign in to continue.',
};

export const useAuth = create<AuthState>((set, get) => ({
  status: 'booting',
  employee: null,
  config: null,
  serverUrl: DEFAULT_API_URL,
  notice: null,

  boot: async () => {
    await initDatabase();
    const saved = await getKv(KV_SERVER_URL);
    if (saved) setBaseUrl(saved);
    set({ serverUrl: getBaseUrl() });

    setSessionEndedHandler((reason) => {
      syncEngine.stop();
      void clearServerCache().catch(() => undefined);
      set({ status: 'signedOut', employee: null, config: null, notice: MESSAGES[reason] ?? MESSAGES.session_ended });
    });

    const tokens = await loadTokens();
    if (!tokens) {
      set({ status: 'signedOut' });
      return;
    }

    // Start from the cached profile so the app opens instantly (and offline), then refresh it.
    const cached = await getCache<Me>(CACHE_ME);
    if (cached) {
      set({ status: 'signedIn', employee: cached.data.employee, config: cached.data.config });
      syncEngine.start(cached.data.employee.id);
      void get().refreshMe();
      return;
    }
    try {
      await get().refreshMe();
      if (get().employee) set({ status: 'signedIn' });
      else set({ status: 'signedOut' });
    } catch {
      await clearTokens();
      set({ status: 'signedOut' });
    }
  },

  signIn: async (identifier, password) => {
    const device = await deviceForLogin();
    const pair = await api.login(identifier.trim(), password, device);
    await saveTokens(tokensFromPair(pair));
    const me: Me = { employee: pair.employee, config: (await fetchConfigSafe()) ?? fallbackConfig(pair.employee) };
    await setCache(CACHE_ME, me);
    set({ status: 'signedIn', employee: me.employee, config: me.config, notice: null });
    syncEngine.start(me.employee.id);
  },

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      // offline or already expired: signing out locally is still the right outcome
    }
    syncEngine.stop();
    await clearTokens();
    await clearServerCache();
    set({ status: 'signedOut', employee: null, config: null, notice: null });
  },

  refreshMe: async () => {
    try {
      const me = await api.me();
      await setCache(CACHE_ME, me);
      set({ employee: me.employee, config: me.config });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      // offline: keep the cached profile
    }
  },

  setServerUrl: async (url) => {
    const problem = serverUrlProblem(url);
    if (problem) throw new Error(problem);
    const normalized = normalizeServerUrl(url);
    setBaseUrl(normalized);
    await setKv(KV_SERVER_URL, normalized);
    set({ serverUrl: normalized });
  },

  markPasswordChanged: () => {
    const employee = get().employee;
    if (employee) set({ employee: { ...employee, must_change_password: false } });
  },

  clearNotice: () => set({ notice: null }),
}));

async function fetchConfigSafe(): Promise<ClientConfig | null> {
  try {
    return (await api.me()).config;
  } catch {
    return null;
  }
}

function fallbackConfig(employee: Employee): ClientConfig {
  return {
    server_time: new Date().toISOString(),
    timezone: 'Asia/Kolkata',
    daily_target: employee.daily_target,
    default_phone_region: 'IN',
    recording: { enabled: false, notice_text: '', max_size_mb: 100, allowed_types: [] },
    dispositions: [],
    unread_notifications: 0,
  };
}
