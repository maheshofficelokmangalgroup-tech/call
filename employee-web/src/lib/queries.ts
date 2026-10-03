import { QueryClient, useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { NetworkError, isTransient } from "./api";
import { serverToRow, type CallRowModel } from "./callModels";
import { api } from "./endpoints";
import type { AppNotification, Callback, Contact, ContactDetail, Dashboard, Note, Page, QueueItem, QueueResponse, ServerCall } from "./types";

const POLL_MS = 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) => isTransient(error) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}

export const qk = {
  queue: ["queue"] as const,
  dashboard: ["dashboard"] as const,
  callbacks: ["callbacks"] as const,
  notifications: ["notifications"] as const,
  wrapup: ["wrapup"] as const,
  history: ["history"] as const,
  contact: (id: number) => ["contact", id] as const,
  contactNotes: (id: number) => ["contact", id, "notes"] as const,
  contactCalls: (id: number) => ["contact", id, "calls"] as const,
  call: (id: number) => ["call", id] as const,
  search: (q: string) => ["contacts", q] as const,
};

/** True when a query failed because the server could not be reached (as opposed to the server saying no). */
export const isOffline = (query: { error: unknown }) => query.error instanceof NetworkError;

/** Everything a finished call changes: the queue, the numbers on Home, the history and the contact's own page. */
export function invalidateAfterCall(client: QueryClient, contactId: number | null): void {
  for (const key of [qk.queue, qk.dashboard, qk.callbacks, qk.wrapup, qk.history]) void client.invalidateQueries({ queryKey: key });
  if (contactId !== null) void client.invalidateQueries({ queryKey: qk.contact(contactId) });
}

// ------------------------------------------------------------------ queue
const QUEUE_PAGE = 100;

export interface QueueData {
  items: QueueItem[];
  total: number;
  dueCallbacks: number;
}

export function useQueue(): UseInfiniteQueryResult<InfiniteData<QueueResponse>> & { data: QueueData | undefined } {
  const query = useInfiniteQuery({
    queryKey: qk.queue,
    queryFn: ({ pageParam, signal }) => api.queue(QUEUE_PAGE, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
    refetchInterval: POLL_MS,
  });
  const pages = query.data?.pages;
  const data: QueueData | undefined = pages
    ? { items: pages.flatMap((p) => p.items), total: pages[0].total, dueCallbacks: pages[0].due_callbacks }
    : undefined;
  return { ...query, data } as UseInfiniteQueryResult<InfiniteData<QueueResponse>> & { data: QueueData | undefined };
}

// ------------------------------------------------------------------ simple lists
export function useDashboard(): UseQueryResult<Dashboard> {
  return useQuery({ queryKey: qk.dashboard, queryFn: ({ signal }) => api.dashboard(undefined, signal), refetchInterval: POLL_MS });
}

export function useCallbacks(): UseQueryResult<Callback[]> {
  return useQuery({ queryKey: qk.callbacks, queryFn: async ({ signal }) => (await api.callbacks("pending", 1, 100, signal)).items, refetchInterval: POLL_MS });
}

export function useNotifications(): UseQueryResult<AppNotification[]> {
  return useQuery({ queryKey: qk.notifications, queryFn: async ({ signal }) => (await api.notifications(1, signal)).items });
}

/** Calls whose outcome has not been recorded yet. */
export function useWrapup(): UseQueryResult<ServerCall[]> {
  return useQuery({
    queryKey: qk.wrapup,
    queryFn: async ({ signal }) => (await api.calls({ needs_disposition: true, page: 1, page_size: 50 }, signal)).items.filter((c) => c.status !== "failed"),
    refetchInterval: POLL_MS,
  });
}

// ------------------------------------------------------------------ one contact / one call
export function useContact(id: number): UseQueryResult<ContactDetail> {
  return useQuery({ queryKey: qk.contact(id), queryFn: ({ signal }) => api.contact(id, signal) });
}

export function useContactNotes(id: number): UseQueryResult<Note[]> {
  return useQuery({ queryKey: qk.contactNotes(id), queryFn: async ({ signal }) => (await api.contactNotes(id, 1, signal)).items });
}

export function useContactCalls(id: number): UseQueryResult<CallRowModel[]> {
  return useQuery({ queryKey: qk.contactCalls(id), queryFn: async ({ signal }) => (await api.contactCalls(id, 1, signal)).items.map(serverToRow) });
}

export function useCall(id: number): UseQueryResult<ServerCall> {
  return useQuery({ queryKey: qk.call(id), queryFn: ({ signal }) => api.call(id, signal), staleTime: 0 });
}

// ------------------------------------------------------------------ paged lists
const CALLS_PAGE = 50;

export function useHistory() {
  const query = useInfiniteQuery({
    queryKey: qk.history,
    queryFn: ({ pageParam, signal }) => api.calls({ page: pageParam, page_size: CALLS_PAGE }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
  });
  const rows: CallRowModel[] = query.data?.pages.flatMap((p) => p.items.map(serverToRow)) ?? [];
  return { ...query, rows };
}

const CONTACTS_PAGE = 30;

/** Contacts assigned to the employee, filtered by what was typed (name, number, city, tag ...). */
export function useContactSearch(text: string, enabled: boolean) {
  const q = useDebounced(text.trim(), 300);
  const query = useInfiniteQuery({
    queryKey: qk.search(q),
    queryFn: ({ pageParam, signal }): Promise<Page<Contact>> => api.contacts({ q: q || undefined, page: pageParam, page_size: CONTACTS_PAGE, sort: "name" }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  // while typing, the list on screen is still for the previous text
  const settling = text.trim() !== q;
  return { ...query, items, total, settling };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
