import { create } from 'zustand';

export interface SyncState {
  running: boolean;
  pending: number;
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
  /** false when the last attempt could not reach the server */
  online: boolean;
  patch: (partial: Partial<Omit<SyncState, 'patch'>>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  running: false,
  pending: 0,
  failed: 0,
  lastSyncAt: null,
  lastError: null,
  online: true,
  patch: (partial) => set(partial),
}));
