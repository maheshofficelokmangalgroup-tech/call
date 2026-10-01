import { create } from 'zustand';

import type { DispositionCode } from '../services/api/types';

/**
 * Lifecycle of the call the employee is making right now.
 *   placing      -> handed to the phone's dialer, waiting for the phone to go off-hook
 *   in_progress  -> the call is on (dialing / ringing / talking are not distinguishable from the phone state)
 *   finishing    -> hung up; reading the call log to learn whether it was answered and for how long
 *   needs_outcome-> reconciled; the employee must record the outcome
 *   failed       -> the call could not be placed
 */
export type CallPhase = 'placing' | 'in_progress' | 'finishing' | 'needs_outcome' | 'failed';

export interface ActiveCall {
  uuid: string;
  contactId: number | null;
  contactName: string | null;
  phone: string;
  campaignId: number | null;
  startedAt: number;
  offhookAt: number | null;
  endedAt: number | null;
  phase: CallPhase;
  durationSec: number;
  answered: boolean;
  suggested: DispositionCode | null;
  error: string | null;
}

interface CallStoreState {
  active: ActiveCall | null;
  /** Set when a wrap-up screen has already been shown for this call, so it is not pushed twice. */
  outcomeShownFor: string | null;
  setActive: (call: ActiveCall | null) => void;
  patchActive: (uuid: string, patch: Partial<ActiveCall>) => void;
  markOutcomeShown: (uuid: string | null) => void;
}

export const useCallStore = create<CallStoreState>((set, get) => ({
  active: null,
  outcomeShownFor: null,
  setActive: (call) => set({ active: call, outcomeShownFor: call ? get().outcomeShownFor : null }),
  patchActive: (uuid, patch) => {
    const current = get().active;
    if (current && current.uuid === uuid) set({ active: { ...current, ...patch } });
  },
  markOutcomeShown: (uuid) => set({ outcomeShownFor: uuid }),
}));
