/** Minimal pub/sub so screens refresh when data they show changes elsewhere (after a sync, an outcome, ...). */
type Topic = 'queue' | 'dashboard' | 'callbacks' | 'history' | 'notifications' | 'contact';
type Listener = (payload?: unknown) => void;

const listeners = new Map<Topic, Set<Listener>>();

export const dataEvents = {
  on(topic: Topic, listener: Listener): () => void {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic)!.add(listener);
    return () => listeners.get(topic)?.delete(listener);
  },
  emit(topic: Topic, payload?: unknown): void {
    listeners.get(topic)?.forEach((l) => l(payload));
  },
  emitAll(): void {
    (['queue', 'dashboard', 'callbacks', 'history', 'notifications', 'contact'] as Topic[]).forEach((t) => this.emit(t));
  },
};
