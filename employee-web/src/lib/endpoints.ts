import { http } from "./api";
import type {
  AppNotification,
  Callback,
  Contact,
  ContactDetail,
  Dashboard,
  DeviceInfoPayload,
  Me,
  Note,
  Page,
  PlaybackUrl,
  QueueResponse,
  ServerCall,
  TokenPair,
} from "./types";

export interface CallCreateBody {
  client_call_id: string;
  contact_id?: number | null;
  phone_number?: string;
  campaign_id?: number | null;
  started_at: string;
  external_call_reference?: string | null;
}

export interface CallEventBody {
  event_type: "dialing" | "ringing" | "connected" | "ended" | "failed" | "app_resumed" | "reconciled" | "note";
  occurred_at: string;
  payload?: Record<string, unknown> | null;
}

export interface DispositionBody {
  disposition_code: string;
  notes?: string | null;
  callback_at?: string | null;
  callback_note?: string | null;
  note_client_ref?: string | null;
}

export interface CallsQuery {
  page?: number;
  page_size?: number;
  needs_disposition?: boolean;
  contact_id?: number;
  status?: string;
  q?: string;
  day?: string;
}

export interface ContactsQuery {
  q?: string;
  page?: number;
  page_size?: number;
  status?: string;
  sort?: string;
}

export const api = {
  // ---- auth
  login: (identifier: string, password: string, device: DeviceInfoPayload) =>
    http.post<TokenPair>("/auth/login", { identifier, password, device }, { auth: false }),
  logout: () => http.post<void>("/auth/logout"),
  changePassword: (current_password: string, new_password: string) =>
    http.post<{ message: string }>("/auth/change-password", { current_password, new_password }),

  // ---- profile / config
  me: (signal?: AbortSignal) => http.get<Me>("/me", undefined, { signal }),

  // ---- queue & contacts
  queue: (limit = 100, offset = 0, signal?: AbortSignal) => http.get<QueueResponse>("/queue", { limit, offset }, { signal }),
  contacts: (params: ContactsQuery, signal?: AbortSignal) => http.get<Page<Contact>>("/contacts", { ...params }, { signal }),
  contact: (id: number, signal?: AbortSignal) => http.get<ContactDetail>(`/contacts/${id}`, undefined, { signal }),
  contactNotes: (id: number, page = 1, signal?: AbortSignal) => http.get<Page<Note>>(`/contacts/${id}/notes`, { page, page_size: 30 }, { signal }),
  addNote: (contactId: number, body: string, clientRef: string) => http.post<Note>(`/contacts/${contactId}/notes`, { body, client_ref: clientRef }),
  contactCalls: (id: number, page = 1, signal?: AbortSignal) => http.get<Page<ServerCall>>(`/contacts/${id}/calls`, { page, page_size: 30 }, { signal }),

  // ---- calls
  createCall: (body: CallCreateBody) => http.post<ServerCall>("/calls", body),
  addCallEvents: (id: number, events: CallEventBody[]) => http.post<{ added: number }>(`/calls/${id}/events`, { events }),
  setDisposition: (id: number, body: DispositionBody) => http.post<ServerCall>(`/calls/${id}/disposition`, body),
  calls: (params: CallsQuery, signal?: AbortSignal) => http.get<Page<ServerCall>>("/calls", { ...params }, { signal }),
  call: (id: number, signal?: AbortSignal) => http.get<ServerCall>(`/calls/${id}`, undefined, { signal }),

  // ---- callbacks
  callbacks: (status: "pending" | "done" | "cancelled" = "pending", page = 1, pageSize = 100, signal?: AbortSignal) =>
    http.get<Page<Callback>>("/callbacks", { status, page, page_size: pageSize }, { signal }),
  createCallback: (body: { contact_id: number; scheduled_at: string; note?: string | null; client_ref: string }) => http.post<Callback>("/callbacks", body),
  updateCallback: (id: number, body: { scheduled_at?: string; status?: "done" | "cancelled"; note?: string | null }) =>
    http.patch<Callback>(`/callbacks/${id}`, body),

  // ---- recordings
  playbackUrl: (id: number) => http.get<PlaybackUrl>(`/recordings/${id}/playback-url`, { mode: "play" }),

  // ---- dashboard & notifications
  dashboard: (day?: string, signal?: AbortSignal) => http.get<Dashboard>("/dashboard", { day }, { signal }),
  notifications: (page = 1, signal?: AbortSignal) => http.get<Page<AppNotification>>("/notifications", { page, page_size: 50 }, { signal }),
  markNotificationRead: (id: number) => http.post<AppNotification>(`/notifications/${id}/read`),
  markAllNotificationsRead: () => http.post<{ message: string }>("/notifications/read-all"),
};
