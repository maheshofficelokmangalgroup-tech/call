import type { components } from "./api-types";

/** Shorthand for the response / request models of the backend (generated from its OpenAPI document). */
type S = components["schemas"];

export type Overview = S["OverviewOut"];
export type Totals = S["Totals"];
export type DayPoint = S["DayPoint"];
export type HourPoint = S["HourPoint"];
export type OutcomeCount = S["OutcomeCount"];
export type StatusCount = S["StatusCount"];
export type RecordingInsight = S["RecordingInsight"];
export type EmployeeMetrics = S["EmployeeMetrics"];
export type EmployeeStats = S["EmployeeStatsOut"];
export type EmployeeDetail = S["EmployeeDetailOut"];
export type ContactStat = S["ContactStat"];
export type Live = S["LiveOut"];
export type FollowupSummary = S["FollowupSummaryOut"];
export type EmployeeFollowups = S["EmployeeFollowups"];
export type FollowupCounts = S["FollowupCounts"];
export type Conversation = S["ConversationOut"];
export type ConversationTimeline = S["TimelineOut"];
export type TimelineCall = S["TimelineCallOut"];
export type FollowupItem = S["FollowupItemOut"];
export type FollowupBrief = S["FollowupBrief"];
export type NoteBrief = S["NoteBrief"];
export type ResponseChip = S["ResponseChip"];
export type LiveCall = S["LiveCall"];
export type RecentCall = S["RecentCall"];
export type Presence = EmployeeMetrics["presence"];

export type Call = S["CallOut"];
export type CallEvent = S["CallEventOut"];
export type Recording = S["RecordingOut"];
export type Employee = S["EmployeeOut"];
export type EmployeeCreate = S["EmployeeCreate"];
export type EmployeeUpdate = S["EmployeeUpdate"];
export type BulkEmployeesResult = S["BulkEmployeesOut"];
export type Team = S["TeamOut"];
export type Device = S["DeviceOut"];
export type DeviceStatus = S["DeviceStatus"];
export type Session = S["SessionOut"];
export type AuditLog = S["AuditLogOut"];
export type Settings = S["SettingsOut"];
export type Disposition = S["DispositionOut"];

export type Contact = S["ContactBrief"];
export type ContactCreate = S["ContactCreate"];
export type ContactUpdate = S["ContactUpdate"];
export type AssignRequest = S["AssignRequest"];
export type AssignResult = S["AssignResult"];
export type Note = S["NoteOut"];
export type ContactDetail = S["ContactOut"];
export type Campaign = S["CampaignOut"];
export type CampaignCreate = S["CampaignCreate"];
export type CampaignUpdate = S["CampaignUpdate"];
export type ImportJob = S["ImportOut"];
export type ImportRow = S["ImportRowOut"];
export type ImportPlan = S["ImportPlanOut"];
export type PlanEmployee = S["PlanEmployee"];
export type DistributionChoice = S["DistributionIn"];
export type WorkState = S["EmployeeStateOut"]["state"];
export type EmployeeWorkState = S["EmployeeStateOut"];
export type ActivityOverview = S["ActivityOverviewOut"];
export type RebalanceRequest = S["RebalanceIn"];
export type RebalancePlan = S["RebalancePlanOut"];
export type RebalanceRun = S["RebalanceRunOut"];
export type Credential = S["CredentialOut"];

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export interface MeResponse {
  employee: Employee;
  config: S["ClientConfig"];
}

export type DateRange = { from: string; to: string };
