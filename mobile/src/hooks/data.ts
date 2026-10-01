import { useEffect, useMemo, useState } from 'react';

import { getContactIdsWithPendingOutcome } from '../database/calls';
import { upsertContacts } from '../database/contacts';
import { api } from '../services/api/endpoints';
import type { AppNotification, Callback, Dashboard, QueueResponse } from '../services/api/types';
import { dataEvents } from '../services/data/events';
import { syncEngine } from '../services/sync/syncEngine';
import { useAuth } from '../store/authStore';
import { useSyncStore } from '../store/syncStore';
import { useCachedQuery } from './useCachedQuery';

function useEmployeeId(): number | null {
  return useAuth((s) => s.employee?.id ?? null);
}

const QUEUE_TOPICS = ['queue'] as const;
const DASH_TOPICS = ['dashboard'] as const;
const CB_TOPICS = ['callbacks'] as const;
const NOTI_TOPICS = ['notifications'] as const;

/** Refresh the screens whose data the server changes when queued operations sync. */
export function useRefreshOnSync(): void {
  useEffect(() => syncEngine.onSynced(() => dataEvents.emitAll()), []);
}

export function useQueue() {
  const id = useEmployeeId();
  const pendingOps = useSyncStore((s) => s.pending);
  const fetcher = useMemo(
    () => async (): Promise<QueueResponse> => {
      const res = await api.queue(200);
      await upsertContacts(res.items.map((i) => i.contact));
      return res;
    },
    [],
  );
  const query = useCachedQuery<QueueResponse>(id ? `e${id}:queue` : null, fetcher, { topics: [...QUEUE_TOPICS], enabled: id !== null });

  // Hide contacts you already finished on this phone while their outcome is still waiting to sync.
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    void getContactIdsWithPendingOutcome(id).then((ids) => alive && setHidden(ids));
    return () => {
      alive = false;
    };
  }, [id, pendingOps, query.data]);

  const data = useMemo<QueueResponse | null>(() => {
    if (!query.data || hidden.size === 0) return query.data;
    const items = query.data.items.filter((i) => !hidden.has(i.contact.id));
    return { ...query.data, items, total: Math.max(0, query.data.total - (query.data.items.length - items.length)) };
  }, [query.data, hidden]);

  return { ...query, data };
}

export function useDashboard() {
  const id = useEmployeeId();
  const fetcher = useMemo(() => () => api.dashboard(), []);
  return useCachedQuery<Dashboard>(id ? `e${id}:dashboard` : null, fetcher, { topics: [...DASH_TOPICS], enabled: id !== null });
}

export function useCallbacks() {
  const id = useEmployeeId();
  const fetcher = useMemo(
    () => async (): Promise<Callback[]> => (await api.callbacks('pending', 1, 100)).items,
    [],
  );
  return useCachedQuery<Callback[]>(id ? `e${id}:callbacks` : null, fetcher, { topics: [...CB_TOPICS], enabled: id !== null });
}

export function useNotifications() {
  const id = useEmployeeId();
  const fetcher = useMemo(() => async (): Promise<AppNotification[]> => (await api.notifications(1)).items, []);
  return useCachedQuery<AppNotification[]>(id ? `e${id}:notifications` : null, fetcher, { topics: [...NOTI_TOPICS], enabled: id !== null });
}
