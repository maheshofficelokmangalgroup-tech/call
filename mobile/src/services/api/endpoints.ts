import { UPLOAD_TIMEOUT_MS } from '../../config/env';
import { http } from './client';
import type {
  AppNotification,
  Callback,
  ContactDetail,
  Contact,
  Dashboard,
  DeviceInfoPayload,
  HeartbeatAnswer,
  Me,
  Note,
  Page,
  PlaybackUrl,
  QueueResponse,
  RecordingInfo,
  ServerCall,
  TokenPair,
} from './types';

export interface CallCreateBody {
  client_call_id: string;
  contact_id?: number | null;
  phone_number?: string;
  campaign_id?: number | null;
  started_at: string;
  external_call_reference?: string | null;
}

export interface CallUpdateBody {
  status?: string;
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number;
  external_call_reference?: string | null;
}

export interface CallEventBody {
  event_type: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed' | 'app_resumed' | 'reconciled' | 'note';
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

export interface HeartbeatBody {
  app_state: 'foreground' | 'background';
  battery_percent?: number;
  charging?: boolean;
  network?: 'wifi' | 'cellular' | 'none' | 'other';
  app_version?: string;
  os_version?: string;
  pending_sync?: number;
  permissions_ok?: boolean;
  missing_permissions?: string[];
  on_call?: boolean;
  client_time?: string;
}

export const api = {
  // ---- auth
  login: (identifier: string, password: string, device: DeviceInfoPayload | null) =>
    http.post<TokenPair>('/auth/login', { identifier, password, device }, { auth: false }),
  logout: () => http.post<void>('/auth/logout'),
  changePassword: (current_password: string, new_password: string) =>
    http.post<{ message: string }>('/auth/change-password', { current_password, new_password }),

  // ---- profile / config
  me: () => http.get<Me>('/me'),
  heartbeat: (body: HeartbeatBody) => http.post<HeartbeatAnswer>('/me/heartbeat', body),

  // ---- queue & contacts
  queue: (limit = 200) => http.get<QueueResponse>('/queue', { limit }),
  contacts: (params: { q?: string; page?: number; page_size?: number; status?: string; sort?: string }) =>
    http.get<Page<Contact>>('/contacts', params),
  contact: (id: number) => http.get<ContactDetail>(`/contacts/${id}`),
  contactNotes: (id: number, page = 1) => http.get<Page<Note>>(`/contacts/${id}/notes`, { page, page_size: 30 }),
  addNote: (contactId: number, body: string, clientRef: string) =>
    http.post<Note>(`/contacts/${contactId}/notes`, { body, client_ref: clientRef }),
  contactCalls: (id: number, page = 1) => http.get<Page<ServerCall>>(`/contacts/${id}/calls`, { page, page_size: 30 }),

  // ---- calls
  createCall: (body: CallCreateBody) => http.post<ServerCall>('/calls', body),
  updateCall: (id: number, body: CallUpdateBody) => http.patch<ServerCall>(`/calls/${id}`, body),
  addCallEvents: (id: number, events: CallEventBody[]) => http.post<{ added: number }>(`/calls/${id}/events`, { events }),
  setDisposition: (id: number, body: DispositionBody) => http.post<ServerCall>(`/calls/${id}/disposition`, body),
  calls: (params: { page?: number; page_size?: number; needs_disposition?: boolean; contact_id?: number; status?: string; q?: string; day?: string }) =>
    http.get<Page<ServerCall>>('/calls', params),
  call: (id: number) => http.get<ServerCall>(`/calls/${id}`),

  // ---- callbacks
  callbacks: (status: 'pending' | 'done' | 'cancelled' = 'pending', page = 1, pageSize = 100) =>
    http.get<Page<Callback>>('/callbacks', { status, page, page_size: pageSize }),
  createCallback: (body: { contact_id: number; scheduled_at: string; note?: string | null; client_ref: string }) =>
    http.post<Callback>('/callbacks', body),
  updateCallback: (id: number, body: { scheduled_at?: string; status?: 'done' | 'cancelled'; note?: string | null }) =>
    http.patch<Callback>(`/callbacks/${id}`, body),

  // ---- recordings
  createRecording: (callId: number, body: { content_type: string; size_bytes: number; duration_seconds?: number | null; sha256?: string }) =>
    http.post<RecordingInfo>(`/calls/${callId}/recording`, body),
  uploadRecording: (recordingId: number, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    return http.upload<RecordingInfo>(`/recordings/${recordingId}/upload`, form, UPLOAD_TIMEOUT_MS);
  },
  recording: (id: number) => http.get<RecordingInfo>(`/recordings/${id}`),
  playbackUrl: (id: number) => http.get<PlaybackUrl>(`/recordings/${id}/playback-url`, { mode: 'play' }),

  // ---- dashboard & notifications
  dashboard: (day?: string) => http.get<Dashboard>('/dashboard', { day }),
  notifications: (page = 1) => http.get<Page<AppNotification>>('/notifications', { page, page_size: 50 }),
  markNotificationRead: (id: number) => http.post<AppNotification>(`/notifications/${id}/read`),
  markAllNotificationsRead: () => http.post<{ message: string }>('/notifications/read-all'),
  unreadNotifications: () => http.get<{ unread: number }>('/notifications/unread-count'),

  // ---- ops
  health: () => http.get<{ status: string; version: string }>('/health', undefined, { auth: false, root: true, timeoutMs: 8000 }),
};
