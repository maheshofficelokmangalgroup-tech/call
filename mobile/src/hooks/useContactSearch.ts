import { useCallback, useEffect, useRef, useState } from 'react';

import { searchLocalContacts, upsertContacts } from '../database/contacts';
import { NetworkError } from '../services/api/client';
import { api } from '../services/api/endpoints';
import type { Contact } from '../services/api/types';

const PAGE_SIZE = 30;

/** Paged, debounced search over the contacts assigned to the employee. Falls back to the local copy when offline. */
export function useContactSearch(query: string, enabled: boolean) {
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const page = useRef(1);
  const requestId = useRef(0);

  const load = useCallback(
    async (reset: boolean, silent = false) => {
      const id = ++requestId.current;
      if (reset) {
        page.current = 1;
        if (!silent) setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await api.contacts({ q: query.trim() || undefined, page: page.current, page_size: PAGE_SIZE, sort: 'name' });
        if (id !== requestId.current) return;
        await upsertContacts(res.items);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setOffline(false);
      } catch (error) {
        if (id !== requestId.current) return;
        if (error instanceof NetworkError) {
          const local = await searchLocalContacts(query, 100);
          setItems(local);
          setTotal(local.length);
          setOffline(true);
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(true), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, enabled, query]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || offline || items.length >= total) return;
    page.current += 1;
    void load(false);
  }, [loading, loadingMore, offline, items.length, total, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true, true);
  }, [load]);

  return { items, total, loading, loadingMore, refreshing, offline, loadMore, refresh };
}
