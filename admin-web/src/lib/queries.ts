"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api, goToLogin, mediaUrl, parseError } from "@/lib/api";
import type {
  AssignRequest,
  AssignResult,
  AuditLog,
  BulkEmployeesResult,
  Call,
  Campaign,
  CampaignCreate,
  CampaignUpdate,
  Contact,
  ContactCreate,
  ContactDetail,
  ContactUpdate,
  DateRange,
  Device,
  Employee,
  EmployeeCreate,
  EmployeeDetail,
  EmployeeStats,
  EmployeeUpdate,
  ImportJob,
  ImportRow,
  Live,
  MeResponse,
  Note,
  Overview,
  Page,
  Session,
  Settings,
  Team,
} from "@/lib/types";

// ------------------------------------------------------------------------------------------------- session
async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
  if (res.status === 401) {
    goToLogin();
    throw new ApiError(401, "unauthenticated", "Please sign in.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MeResponse;
}

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: 5 * 60_000, retry: false });

// ------------------------------------------------------------------------------------------------- analytics
export interface Scope {
  teamId?: number | null;
  employeeId?: number | null;
}

export function useOverview(range: DateRange, scope: Scope = {}) {
  return useQuery({
    queryKey: ["overview", range.from, range.to, scope.teamId ?? null, scope.employeeId ?? null],
    queryFn: ({ signal }) =>
      api<Overview>("analytics/overview", {
        params: { date_from: range.from, date_to: range.to, team_id: scope.teamId, employee_id: scope.employeeId },
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export interface EmployeeFilters {
  q?: string;
  teamId?: number | null;
  role?: string;
  state?: "all" | "active" | "inactive";
  presence?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export function useEmployeeStats(range: DateRange, filters: EmployeeFilters = {}) {
  return useQuery({
    queryKey: ["employee-stats", range.from, range.to, filters],
    queryFn: ({ signal }) =>
      api<EmployeeStats>("analytics/employees", {
        params: {
          date_from: range.from,
          date_to: range.to,
          q: filters.q,
          team_id: filters.teamId,
          role: filters.role,
          state: filters.state,
          presence: filters.presence,
          sort: filters.sort,
          order: filters.order,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useEmployeeDetail(id: number, range: DateRange) {
  return useQuery({
    queryKey: ["employee-detail", id, range.from, range.to],
    queryFn: ({ signal }) => api<EmployeeDetail>(`analytics/employees/${id}`, { params: { date_from: range.from, date_to: range.to }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export const useLive = () =>
  useQuery({
    queryKey: ["live"],
    queryFn: ({ signal }) => api<Live>("analytics/live", { signal }),
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
  });

// ------------------------------------------------------------------------------------------------- calls
export interface CallFilters {
  employeeId?: number | null;
  status?: string;
  disposition?: string;
  hasRecording?: boolean;
  minDuration?: number;
  q?: string;
  sort?: "newest" | "oldest" | "longest";
  page?: number;
  pageSize?: number;
}

export function callParams(range: DateRange | null, f: CallFilters) {
  return {
    from_day: range?.from,
    to_day: range?.to,
    employee_id: f.employeeId,
    status: f.status,
    disposition: f.disposition,
    has_recording: f.hasRecording === undefined ? undefined : String(f.hasRecording),
    min_duration: f.minDuration,
    q: f.q,
    sort: f.sort,
  };
}

export function useCalls(range: DateRange | null, filters: CallFilters) {
  return useQuery({
    queryKey: ["calls", range?.from ?? null, range?.to ?? null, filters],
    queryFn: ({ signal }) =>
      api<Page<Call>>("calls", { params: { ...callParams(range, filters), page: filters.page ?? 1, page_size: filters.pageSize ?? 25 }, signal }),
    placeholderData: keepPreviousData,
  });
}

export const useCall = (id: number | null) =>
  useQuery({
    queryKey: ["call", id],
    queryFn: ({ signal }) => api<Call>(`calls/${id}`, { signal }),
    enabled: id !== null,
  });

/** Ask for a short-lived link to a recording. Every request is written to the recording's access log, so this is only called when someone presses play or download. */
export async function issuePlaybackUrl(recordingId: number, mode: "play" | "download"): Promise<string> {
  const issued = await api<{ url: string }>(`recordings/${recordingId}/playback-url`, { params: { mode } });
  return mediaUrl(issued.url);
}

export function useDeleteRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`recordings/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      for (const key of ["calls", "call", "overview", "employee-detail", "employee-stats"]) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

// ------------------------------------------------------------------------------------------------- people & structure
export const useTeams = () => useQuery({ queryKey: ["teams"], queryFn: ({ signal }) => api<Team[]>("teams", { signal }), staleTime: 60_000 });

export function useEmployeeList(params: { q?: string; teamId?: number | null; isActive?: boolean; role?: string } = {}) {
  return useQuery({
    queryKey: ["employees", params],
    queryFn: ({ signal }) =>
      api<Page<Employee>>("employees", { params: { q: params.q, team_id: params.teamId, is_active: params.isActive === undefined ? undefined : String(params.isActive), role: params.role, page_size: 200 }, signal }),
    staleTime: 30_000,
  });
}

export function useInvalidateEmployees() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["employees", "employee-stats", "employee-detail", "overview", "live"]) void qc.invalidateQueries({ queryKey: [key] });
  };
}

export function useCreateEmployee() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (body: EmployeeCreate) => api<{ employee: Employee; temporary_password: string | null }>("employees", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useBulkCreateEmployees() {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (employees: EmployeeCreate[]) => api<BulkEmployeesResult>("employees/bulk", { method: "POST", body: { employees } }),
    onSuccess: invalidate,
  });
}

export function useUpdateEmployee(id: number) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (body: EmployeeUpdate) => api<Employee>(`employees/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useEmployeeAction(id: number) {
  const invalidate = useInvalidateEmployees();
  return useMutation({
    mutationFn: (action: "activate" | "deactivate" | "revoke-sessions") => api<unknown>(`employees/${id}/${action}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export const useResetPassword = (id: number) =>
  useMutation({ mutationFn: (newPassword?: string) => api<{ temporary_password: string }>(`employees/${id}/reset-password`, { method: "POST", body: { new_password: newPassword || null } }) });

export const useEmployeeDevices = (id: number) => useQuery({ queryKey: ["employee-devices", id], queryFn: ({ signal }) => api<Device[]>(`employees/${id}/devices`, { signal }) });

export const useEmployeeSessions = (id: number) => useQuery({ queryKey: ["employee-sessions", id], queryFn: ({ signal }) => api<Session[]>(`employees/${id}/sessions`, { signal }) });

export function useUnbindDevice(employeeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: number) => api<void>(`employees/${employeeId}/devices/${deviceId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employee-devices", employeeId] });
      void qc.invalidateQueries({ queryKey: ["employee-detail", employeeId] });
    },
  });
}

export function useTeamMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["teams"] });
    void qc.invalidateQueries({ queryKey: ["employee-stats"] });
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; description?: string | null }) => api<Team>("teams", { method: "POST", body: b }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: number; name?: string; description?: string | null; is_active?: boolean }) => api<Team>(`teams/${id}`, { method: "PATCH", body: b }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`teams/${id}`, { method: "DELETE" }), onSuccess: refresh }),
  };
}

// ------------------------------------------------------------------------------------------------- settings, audit
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: ({ signal }) => api<Settings>("settings", { signal }) });

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api<Settings>(`settings/${key}`, { method: "PUT", body: { value } }),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      void qc.invalidateQueries({ queryKey: ["overview"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export interface AuditFilters {
  action?: string;
  actorId?: number | null;
  page?: number;
}

export function useAuditLogs(filters: AuditFilters, range: DateRange | null) {
  return useQuery({
    queryKey: ["audit", filters, range?.from ?? null, range?.to ?? null],
    queryFn: ({ signal }) =>
      api<Page<AuditLog>>("audit-logs", {
        params: { action: filters.action, actor_id: filters.actorId, date_from: range ? `${range.from}T00:00:00+05:30` : undefined, date_to: range ? `${range.to}T23:59:59+05:30` : undefined, page: filters.page ?? 1, page_size: 30 },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------------------------------------- contacts, campaigns, imports
export interface ContactFilters {
  q?: string;
  status?: string;
  priority?: number | null;
  employeeId?: number | null;
  campaignId?: number | null;
  unassigned?: boolean;
  sort?: string;
  page?: number;
}

export function useContacts(f: ContactFilters) {
  return useQuery({
    queryKey: ["contacts", f],
    queryFn: ({ signal }) =>
      api<Page<Contact>>("contacts", {
        params: { q: f.q, status: f.status, priority: f.priority, employee_id: f.employeeId, campaign_id: f.campaignId, unassigned: f.unassigned ? "true" : undefined, sort: f.sort, page: f.page ?? 1, page_size: 25 },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export const useContact = (id: number | null) => useQuery({ queryKey: ["contact", id], queryFn: ({ signal }) => api<ContactDetail>(`contacts/${id}`, { signal }), enabled: id !== null });

export function useContactMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ["contacts", "contact", "campaigns", "campaign-progress"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    create: useMutation({ mutationFn: (body: ContactCreate) => api<ContactDetail>("contacts", { method: "POST", body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: { id: number } & ContactUpdate) => api<ContactDetail>(`contacts/${id}`, { method: "PATCH", body }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`contacts/${id}`, { method: "DELETE" }), onSuccess: refresh }),
    assign: useMutation({ mutationFn: (body: AssignRequest) => api<AssignResult>("contacts/assign", { method: "POST", body }), onSuccess: refresh }),
    unassign: useMutation({ mutationFn: (contactIds: number[]) => api<{ message: string }>("contacts/unassign", { method: "POST", body: { contact_ids: contactIds } }), onSuccess: refresh }),
  };
}

export const useContactCalls = (id: number | null, page: number) =>
  useQuery({
    queryKey: ["contact-calls", id, page],
    queryFn: ({ signal }) => api<Page<Call>>(`contacts/${id}/calls`, { params: { page, page_size: 10 }, signal }),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });

export const useContactNotes = (id: number | null) =>
  useQuery({ queryKey: ["contact-notes", id], queryFn: ({ signal }) => api<Page<Note>>(`contacts/${id}/notes`, { params: { page_size: 50 }, signal }), enabled: id !== null });

export function useAddContactNote(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<Note>(`contacts/${id}/notes`, { method: "POST", body: { body } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["contact-notes", id] }),
  });
}

export function useCampaignMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ["campaigns", "campaign-progress", "campaign-assignees", "contacts"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    create: useMutation({ mutationFn: (body: CampaignCreate) => api<Campaign>("campaigns", { method: "POST", body }), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...body }: { id: number } & CampaignUpdate) => api<Campaign>(`campaigns/${id}`, { method: "PATCH", body }), onSuccess: refresh }),
    setAssignees: useMutation({ mutationFn: ({ id, employeeIds }: { id: number; employeeIds: number[] }) => api<{ employee_ids: number[] }>(`campaigns/${id}/assignees`, { method: "POST", body: { employee_ids: employeeIds, team_ids: [] } }), onSuccess: refresh }),
    distribute: useMutation({ mutationFn: ({ id, strategy, employeeIds }: { id: number; strategy: "round_robin" | "balanced"; employeeIds?: number[] }) => api<AssignResult>(`campaigns/${id}/distribute`, { method: "POST", body: { strategy, employee_ids: employeeIds ?? null } }), onSuccess: refresh }),
  };
}

export const useCampaignAssignees = (id: number | null) =>
  useQuery({ queryKey: ["campaign-assignees", id], queryFn: ({ signal }) => api<{ employee_ids: number[] }>(`campaigns/${id}/assignees`, { signal }), enabled: id !== null });

export interface CampaignProgress {
  campaign: Campaign;
  contacts_by_status: Record<string, number>;
  calls_by_employee: { employee_id: number; name: string; calls: number }[];
}

export const useCampaignProgress = (id: number | null) =>
  useQuery({ queryKey: ["campaign-progress", id], queryFn: ({ signal }) => api<CampaignProgress>(`campaigns/${id}/progress`, { signal }), enabled: id !== null });

export const useCampaigns = () => useQuery({ queryKey: ["campaigns"], queryFn: ({ signal }) => api<Campaign[]>("campaigns", { signal }), staleTime: 30_000 });

export const useImports = () => useQuery({ queryKey: ["imports"], queryFn: ({ signal }) => api<Page<ImportJob>>("contacts/import", { params: { page_size: 20 }, signal }), refetchInterval: 15_000 });

/** One import. While the server is still checking or applying the sheet it is asked again every second and a half. */
export const useImport = (id: number | null) =>
  useQuery({
    queryKey: ["import", id],
    queryFn: ({ signal }) => api<ImportJob>(`contacts/import/${id}`, { signal }),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data && ["validating", "applying"].includes(query.state.data.status) ? 1500 : false),
  });

export const useImportRows = (id: number | null, status: string | undefined, page: number) =>
  useQuery({
    queryKey: ["import-rows", id, status ?? null, page],
    queryFn: ({ signal }) => api<Page<ImportRow>>(`contacts/import/${id}/rows`, { params: { status, page, page_size: 15 }, signal }),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });

export interface UploadImportOptions {
  file: File;
  mode: "skip" | "update";
  campaignId: number | null;
  employeeIds: number[];
  strategy: "round_robin" | "balanced";
  priority: number;
}

export function useImportMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    for (const key of ["imports", "import", "import-rows", "contacts", "campaigns"]) void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    upload: useMutation({
      mutationFn: (o: UploadImportOptions) => {
        const form = new FormData();
        form.append("file", o.file);
        form.append("mode", o.mode);
        if (o.campaignId !== null) form.append("campaign_id", String(o.campaignId));
        form.append("assign_employee_ids", o.employeeIds.join(","));
        form.append("assign_strategy", o.strategy);
        form.append("default_priority", String(o.priority));
        return api<ImportJob>("contacts/import", { method: "POST", form });
      },
      onSuccess: refresh,
    }),
    confirm: useMutation({ mutationFn: ({ id, mode }: { id: number; mode: "skip" | "update" }) => api<ImportJob>(`contacts/import/${id}/confirm`, { method: "POST", body: { mode } }), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: (id: number) => api<ImportJob>(`contacts/import/${id}/cancel`, { method: "POST" }), onSuccess: refresh }),
  };
}
