/** Shapes returned by the backend (see backend/app/schemas). Timestamps arrive as ISO-8601 strings. */

export type Role = 'admin' | 'manager' | 'employee';

export interface Employee {
  id: number;
  employee_code: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  team_id: number | null;
  team_name: string | null;
  is_active: boolean;
  daily_target: number;
  must_change_password: boolean;
  device_binding_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  must_change_password: boolean;
  employee: Employee;
}

export interface Disposition {
  id: number;
  code: DispositionCode;
  label: string;
  category: 'connected' | 'not_connected' | 'other';
  requires_callback: boolean;
  sort_order: number;
}

export type DispositionCode =
  | 'CONNECTED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'SWITCHED_OFF'
  | 'INVALID_NUMBER'
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'CALLBACK'
  | 'FOLLOW_UP'
  | 'COMPLETED'
  | 'DO_NOT_CONTACT';

export interface HeartbeatAnswer {
  server_time: string;
  next_in_seconds: number;
}

export interface RecordingConfig {
  enabled: boolean;
  notice_text: string;
  max_size_mb: number;
  allowed_types: string[];
}

export interface ClientConfig {
  server_time: string;
  timezone: string;
  daily_target: number;
  default_phone_region: string;
  recording: RecordingConfig;
  dispositions: Disposition[];
  unread_notifications: number;
  /** how often an open app reports that it is alive (the server decides) */
  heartbeat_seconds: number;
  /** how often the app retries what it could not send */
  sync_interval_seconds: number;
}

export interface Me {
  employee: Employee;
  config: ClientConfig;
}

/** One number of a person and what happened on it (the server sends every number of a person with the contact). */
export interface ContactPhone {
  /** +91... */
  phone: string;
  phone_raw: string;
  position: number;
  primary: boolean;
  calls: number;
  answered: number;
  /** an employee reported it as not a valid number */
  invalid: boolean;
  last_called_at: string | null;
  last_answered_at: string | null;
}

export interface Contact {
  id: number;
  name: string;
  /** the first number of the person; all of them are in `phones` */
  phone: string;
  /** all numbers of this person (older copies kept on the phone before the update do not have them) */
  phones?: ContactPhone[];
  phone_count?: number;
  /** the number to dial now: the one that was answered, else the one tried least */
  call_phone?: string | null;
  relative_name?: string | null;
  age?: number | null;
  gender?: string | null;
  epic_no?: string | null;
  pincode?: string | null;
  address?: string | null;
  email: string | null;
  location: string | null;
  category: string | null;
  priority: number;
  tags: string[];
  status: string;
  call_count: number;
  last_called_at: string | null;
  last_disposition_code: string | null;
}

export interface ContactDetail extends Contact {
  phone_raw: string;
  custom_fields: Record<string, string | number | boolean | null>;
  source: string | null;
  created_at: string;
  updated_at: string;
  assigned_to: { id: number; name: string; code: string | null } | null;
  campaigns: { id: number; name: string }[];
}

export interface CampaignRef {
  id: number;
  name: string;
}

export interface Callback {
  id: number;
  contact_id: number;
  contact: Contact | null;
  call_id: number | null;
  scheduled_at: string;
  status: 'pending' | 'done' | 'cancelled';
  note: string | null;
  overdue: boolean;
  created_at: string;
}

export interface QueueItem {
  contact: Contact;
  reason: 'callback' | 'retry' | 'new';
  callback: Callback | null;
  campaign: CampaignRef | null;
  attempts: number;
  last_called_at: string | null;
  eligible_at: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  total: number;
  due_callbacks: number;
  server_time: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type CallStatus = 'initiated' | 'dialing' | 'ringing' | 'connected' | 'completed' | 'no_answer' | 'failed';

export interface RecordingInfo {
  id: number;
  uid: string;
  call_id: number;
  upload_status: 'pending' | 'uploading' | 'available' | 'failed';
  content_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  created_at: string;
  uploaded_at: string | null;
  failure_reason: string | null;
}

export interface ServerCall {
  id: number;
  client_call_id: string;
  employee_id: number;
  contact_id: number | null;
  contact_name: string | null;
  phone_number: string;
  campaign_id: number | null;
  attempt_number: number;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  status: CallStatus;
  disposition: { code: DispositionCode; label: string; category: string } | null;
  disposition_at: string | null;
  recording: RecordingInfo | null;
  callback_at: string | null;
  notes: { id: number; body: string; author_name: string | null; created_at: string }[];
  events: { id: number; event_type: string; occurred_at: string; payload: Record<string, unknown> | null }[];
}

export interface Note {
  id: number;
  call_id: number | null;
  contact_id: number | null;
  author_id: number;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface Dashboard {
  scope: string;
  date: string;
  timezone: string;
  assigned_contacts: number;
  pending_contacts: number;
  total_calls: number;
  connected_calls: number;
  no_answer_calls: number;
  busy_calls: number;
  switched_off_calls: number;
  invalid_calls: number;
  completed_calls: number;
  pending_wrapup: number;
  callbacks_due: number;
  callbacks_scheduled_today: number;
  total_talk_seconds: number;
  average_call_seconds: number;
  daily_target: number;
  target_progress_percent: number;
  calls_by_hour: number[];
  generated_at: string;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface PlaybackUrl {
  url: string;
  expires_at: string;
  mode: 'play' | 'download';
}

export interface DeviceInfoPayload {
  device_uid: string;
  name?: string;
  platform?: string;
  os_version?: string;
  app_version?: string;
}
