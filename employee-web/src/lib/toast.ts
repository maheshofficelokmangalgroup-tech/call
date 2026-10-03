import { useSyncExternalStore } from "react";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const DURATION_MS = 3500;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function push(kind: ToastKind, text: string): void {
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, text }];
  emit();
  setTimeout(() => dismiss(id), DURATION_MS);
}

export function dismiss(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
  warning: (text: string) => push("warning", text),
};

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => items,
  );
}

/** For tests. */
export function clearToasts(): void {
  items = [];
  emit();
}
