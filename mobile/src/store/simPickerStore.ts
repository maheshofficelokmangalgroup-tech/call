import { create } from 'zustand';

import type { SimAccount } from '../services/telephony/native';

type Pick = { id: string; remember: boolean } | null;

interface SimPickerState {
  sims: SimAccount[];
  resolver: ((pick: Pick) => void) | null;
  /** Opens the chooser and resolves with the employee's pick (null when they dismiss it). */
  ask: (sims: SimAccount[]) => Promise<Pick>;
  resolve: (pick: Pick) => void;
}

export const useSimPicker = create<SimPickerState>((set, get) => ({
  sims: [],
  resolver: null,
  ask: (sims) =>
    new Promise<Pick>((resolve) => {
      get().resolver?.(null); // a second request replaces an unanswered first one
      set({ sims, resolver: resolve });
    }),
  resolve: (pick) => {
    const resolver = get().resolver;
    set({ resolver: null });
    resolver?.(pick);
  },
}));
