"use client";

import { ScrollText, ShieldAlert } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { usePageReset } from "@/lib/hooks";
import { useAuditLogs, useEmployeeList, useMe } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { cn, formatDate, formatTimeSeconds, timeAgo } from "@/lib/utils";

const ACTIONS: Record<string, { label: string; tone: BadgeTone }> = {
  "auth.login": { label: "Signed in", tone: "brand" },
  "auth.login_failed": { label: "Failed sign-in", tone: "danger" },
  "auth.login_blocked": { label: "Sign-in blocked", tone: "danger" },
  "auth.logout": { label: "Signed out", tone: "neutral" },
  "auth.password_changed": { label: "Changed own password", tone: "info" },
  "auth.refresh_reuse_detected": { label: "Stolen session suspected", tone: "danger" },
  "employee.create": { label: "Created an employee", tone: "brand" },
  "employee.update": { label: "Edited an employee", tone: "info" },
  "employee.activate": { label: "Activated an employee", tone: "brand" },
  "employee.deactivate": { label: "Deactivated an employee", tone: "warn" },
  "employee.reset_password": { label: "Reset a password", tone: "warn" },
  "employee.revoke_sessions": { label: "Signed an employee out", tone: "warn" },
  "employee.device_unbind": { label: "Released a phone", tone: "warn" },
  "recording.access": { label: "Opened a recording", tone: "violet" },
  "recording.delete": { label: "Deleted a recording", tone: "danger" },
  "report.export": { label: "Exported a report", tone: "teal" },
  "settings.update": { label: "Changed a setting", tone: "warn" },
  "team.create": { label: "Created a team", tone: "brand" },
  "team.update": { label: "Edited a team", tone: "info" },
  "team.delete": { label: "Deleted a team", tone: "danger" },
  "contact.create": { label: "Added a contact", tone: "brand" },
  "contact.update": { label: "Edited a contact", tone: "info" },
  "contact.delete": { label: "Deleted a contact", tone: "danger" },
  "contact.assign": { label: "Assigned contacts", tone: "violet" },
  "contact.unassign": { label: "Unassigned contacts", tone: "neutral" },
  "campaign.create": { label: "Created a campaign", tone: "brand" },
  "campaign.update": { label: "Edited a campaign", tone: "info" },
  "campaign.set_assignees": { label: "Changed campaign callers", tone: "violet" },
  "campaign.attach_contacts": { label: "Added contacts to a campaign", tone: "violet" },
  "campaign.detach_contact": { label: "Removed a contact from a campaign", tone: "neutral" },
  "import.upload": { label: "Uploaded a contact sheet", tone: "info" },
  "import.confirm": { label: "Confirmed an import", tone: "brand" },
  "import.completed": { label: "Import finished", tone: "brand" },
  "import.cancel": { label: "Cancelled an import", tone: "neutral" },
};

const GROUPS = [
  { value: "all", label: "Everything" },
  { value: "auth.", label: "Sign-ins and passwords" },
  { value: "employee.", label: "Employee changes" },
  { value: "recording.", label: "Recordings" },
  { value: "report.", label: "Exports" },
  { value: "settings.", label: "Settings" },
  { value: "team.", label: "Teams" },
  { value: "contact.", label: "Contacts" },
  { value: "campaign.", label: "Campaigns" },
  { value: "import.", label: "Imports" },
];

const humanise = (action: string) => {
  const text = action.replace(/[._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The few detail fields worth showing in a table cell, without dumping JSON at the reader. */
function summarise(details: Record<string, unknown> | null): string[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
}

export function AuditView() {
  const me = useMe();
  const { range, label } = useRange();
  const [group, setGroup] = React.useState("all");
  const [actor, setActor] = React.useState("all");
  const [page, setPage] = usePageReset([group, actor, range.from, range.to]);
  const people = useEmployeeList({});
  const logs = useAuditLogs({ action: group === "all" ? undefined : group, actorId: actor === "all" ? null : Number(actor), page }, range);

  if (me.data && me.data.employee.role !== "admin") {
    return (
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <EmptyState icon={ShieldAlert} title="Only administrators can see the audit log" description="Ask an administrator if you need to know who changed something." />
      </div>
    );
  }

  const items = logs.data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="System" title="Audit log" description={<>Who did what {label.toLowerCase()}: sign-ins, changes to accounts, recordings that were opened and reports that were exported.</>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger className="w-56" aria-label="Kind of event" data-testid="audit-group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-52" aria-label="Person" data-testid="audit-actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            {people.data?.items.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {e.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {logs.isError && !logs.data ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The log could not be loaded." onRetry={() => logs.refetch()} />
        </div>
      ) : (
        <TableWrap className={cn(logs.isFetching && !logs.isPending && "opacity-80 transition-opacity")}>
          <Table className="min-w-[860px]" data-testid="audit-table">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>What</TH>
                <TH>About</TH>
                <TH>From</TH>
              </TR>
            </THead>
            <tbody>
              {logs.isPending
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TR key={i}>
                      <TD colSpan={5}>
                        <Skeleton className="h-9 w-full" />
                      </TD>
                    </TR>
                  ))
                : items.map((log) => {
                    const meta = ACTIONS[log.action] ?? { label: humanise(log.action), tone: "neutral" as BadgeTone };
                    const facts = summarise(log.details);
                    return (
                      <TR key={log.id} data-testid="audit-row">
                        <TD>
                          <p className="whitespace-nowrap font-semibold text-ink tnum">{formatTimeSeconds(log.created_at)}</p>
                          <p className="whitespace-nowrap text-xs text-muted">
                            {formatDate(log.created_at)} · {timeAgo(log.created_at)}
                          </p>
                        </TD>
                        <TD className="font-semibold text-ink">{log.actor_label ?? <span className="font-medium text-muted">System</span>}</TD>
                        <TD>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {facts.length > 0 ? <p className="mt-1 max-w-xs truncate text-xs text-muted">{facts.join(" · ")}</p> : null}
                        </TD>
                        <TD className="whitespace-nowrap text-ink-soft">{log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ""}` : "-"}</TD>
                        <TD className="whitespace-nowrap font-mono text-xs text-muted">{log.ip ?? "-"}</TD>
                      </TR>
                    );
                  })}
            </tbody>
          </Table>
          {!logs.isPending && items.length === 0 ? <EmptyState icon={ScrollText} title="Nothing recorded" description="No events match these filters in the selected period." /> : null}
        </TableWrap>
      )}

      <div className="mt-4">
        <Pagination page={page} pageSize={30} total={logs.data?.total ?? 0} onPage={setPage} />
      </div>
    </div>
  );
}
