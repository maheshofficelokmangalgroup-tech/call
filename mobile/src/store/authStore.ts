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
import { heartbeat } from '../services/heartbeat/heartbeat';
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

/** Start (or re-pace) everything that runs while somebody is signed in. A temporary password only opens the password screen. */
function runSession(employee: Employee, config: ClientConfig | null): void {
  syncEngine.start(employee.id, config?.sync_interval_seconds);
  if (employee.must_change_password) heartbeat.stop();
  else heartbeat.start(config?.heartbeat_seconds);
}

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
      heartbeat.stop();
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
      runSession(cached.data.employee, cached.data.config);
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
    // The outcomes, the recording rules and the pace all come from the server (nothing is invented here): asked twice, because the
    // first answer can be lost while the phone is still getting its network after the sign-in.
    const config = (await fetchConfigSafe()) ?? (await fetchConfigSafe());
    if (config) await setCache(CACHE_ME, { employee: pair.employee, config } satisfies Me);
    set({ status: 'signedIn', employee: pair.employee, config, notice: null });
    runSession(pair.employee, config);
    if (!config) void get().refreshMe();
  },

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      // offline or already expired: signing out locally is still the right outcome
    }
    syncEngine.stop();
    heartbeat.stop();
    await clearTokens();
    await clearServerCache();
    set({ status: 'signedOut', employee: null, config: null, notice: null });
  },

  refreshMe: async () => {
    try {
      const me = await api.me();
      await setCache(CACHE_ME, me);
      set({ employee: me.employee, config: me.config });
      syncEngine.setIntervalSeconds(me.config.sync_interval_seconds);
      heartbeat.setInterval(me.config.heartbeat_seconds);
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
    if (employee) {
      const changed = { ...employee, must_change_password: false };
      set({ employee: changed });
      heartbeat.start(get().config?.heartbeat_seconds); // the server answers everything again: report in
    }
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
