import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  current: ToastItem | null;
  show: (message: string, kind?: ToastKind) => void;
  hide: (id?: number) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  show: (message, kind = 'info') => set({ current: { id: ++counter, message, kind } }),
  hide: (id) => {
    const current = get().current;
    if (current && (id === undefined || current.id === id)) set({ current: null });
  },
}));

export const toast = {
  success: (message: string) => useToastStore.getState().show(message, 'success'),
  error: (message: string) => useToastStore.getState().show(message, 'error'),
  info: (message: string) => useToastStore.getState().show(message, 'info'),
  warning: (message: string) => useToastStore.getState().show(message, 'warning'),
};
