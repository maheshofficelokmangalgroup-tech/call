import { useCallback, useEffect, useRef, useState } from 'react';

import { getCache, setCache } from '../database/kvCache';
import { NetworkError } from '../services/api/client';
import { dataEvents } from '../services/data/events';

/** Lets every mounted hook that reads the same cache key see a local (optimistic) change immediately. */
type CacheListener = (value: unknown, origin: symbol) => void;
const cacheListeners = new Map<string, Set<CacheListener>>();
function publishCache(key: string, value: unknown, origin: symbol): void {
  cacheListeners.get(key)?.forEach((l) => l(value, origin));
}
function subscribeCache(key: string, listener: CacheListener): () => void {
  if (!cacheListeners.has(key)) cacheListeners.set(key, new Set());
  cacheListeners.get(key)!.add(listener);
  return () => cacheListeners.get(key)?.delete(listener);
}

export interface CachedQueryResult<T> {
  data: T | null;
  /** first load and nothing cached yet -> show skeletons */
  loading: boolean;
  /** a pull-to-refresh / background refresh is running */
  refreshing: boolean;
  error: Error | null;
  /** the last attempt could not reach the server; `data` is the cached copy */
  offline: boolean;
  updatedAt: number | null;
  refresh: () => Promise<void>;
  /** replace the cached value locally (optimistic updates) */
  mutate: (updater: (current: T | null) => T | null) => void;
}

interface Options {
  /** topics that should trigger a refetch */
  topics?: Parameters<typeof dataEvents.on>[0][];
  /** skip the network (e.g. no employee yet) */
  enabled?: boolean;
}

/**
 * Cache-first data loading: show what is in SQLite immediately, then refresh from the server. When the server cannot
 * be reached the cached copy stays on screen and `offline` is set - the app keeps working (section 20).
 */
export function useCachedQuery<T>(key: string | null, fetcher: () => Promise<T>, options: Options = {}): CachedQueryResult<T> {
  const { topics = [], enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadCache = useCallback(async () => {
    if (!key) return;
    const cached = await getCache<T>(key);
    if (cached && mounted.current) {
      setData(cached.data);
      setUpdatedAt(cached.updatedAt);
      setLoading(false);
    }
  }, [key]);

  const refresh = useCallback(async () => {
    if (!key || !enabled) return;
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setRefreshing(true);
      try {
        const fresh = await fetcherRef.current();
        if (!mounted.current) return;
        setData(fresh);
        setError(null);
        setOffline(false);
        setUpdatedAt(Date.now());
        await setCache(key, fresh);
      } catch (e) {
        if (!mounted.current) return;
        if (e instanceof NetworkError) setOffline(true);
        else setError(e as Error);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [key, enabled]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    void loadCache().then(() => refresh());
  }, [key, enabled, loadCache, refresh]);

  useEffect(() => {
    const unsubscribers = topics.map((topic) => dataEvents.on(topic, () => void refresh()));
    return () => unsubscribers.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, topics.join('|')]);

  const origin = useRef(Symbol('query')).current;

  useEffect(() => {
    if (!key) return;
    return subscribeCache(key, (value, from) => {
      if (from !== origin && mounted.current) setData(value as T);
    });
  }, [key, origin]);

  const mutate = useCallback(
    (updater: (current: T | null) => T | null) => {
      setData((current) => {
        const next = updater(current);
        if (next !== null && key) {
          void setCache(key, next);
          publishCache(key, next, origin);
        }
        return next;
      });
    },
    [key, origin],
  );

  return { data, loading, refreshing, error, offline, updatedAt, refresh, mutate };
}
