"use client";

import { AlarmClock, CalendarCheck, CalendarClock, ChevronRight, MessagesSquare, Phone, Search, Users, X } from "lucide-react";
import * as React from "react";

import { CallDrawer } from "@/components/domain/call-drawer";
import { ConversationDrawer } from "@/components/domain/conversation-drawer";
import { ConversationsTable, NoConversations, ResponseBadge, parseTalkKey, talkKey } from "@/components/domain/conversations-table";
import { EmployeeCell } from "@/components/domain/employee-cell";
import { StatCard } from "@/components/domain/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DUE_TONE, RESPONSE_GROUPS, followupDue, groupByKey, groupCodes, groupCount } from "@/lib/followups";
import { useDebounced, useNow, usePageReset } from "@/lib/hooks";
import { useConversations, useEmployeeList, useFollowupList, useFollowupSummary } from "@/lib/queries";
import { useRange } from "@/lib/range";
import type { EmployeeFollowups, FollowupItem } from "@/lib/types";
import { useCallParam } from "@/lib/use-call-param";
import { useUrlParam } from "@/lib/use-url-param";
import { cn, formatNumber, formatPhone, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 25;

type FollowupState = "overdue" | "today" | "upcoming" | "closed";

// ------------------------------------------------------------------------------------------------- what they answered
function ResponseBreakdown({ responses, people, loading, active, onPick }: { responses: Record<string, number> | undefined; people: number; loading: boolean; active: string; onPick: (key: string) => void }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="response-breakdown">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-bold text-ink">What the people answered</h3>
        <span className="text-xs text-muted">each person counted once, by their latest response</span>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : people === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nobody was called in this period.</p>
      ) : (
        <>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Share of people by response">
            {RESPONSE_GROUPS.map((g) => {
              const n = groupCount(responses, g);
              return n > 0 ? <span key={g.key} style={{ width: `${(100 * n) / people}%`, background: g.color }} title={`${g.label}: ${n}`} /> : null;
            })}
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {RESPONSE_GROUPS.map((g) => {
              const n = groupCount(responses, g);
              const on = active === g.key;
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => onPick(on ? "all" : g.key)}
                    aria-pressed={on}
                    title={g.hint}
                    disabled={n === 0}
                    data-testid={`response-${g.key}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-default disabled:opacity-50",
                      on ? "border-brand bg-brand-soft/60" : "border-line bg-surface hover:bg-surface-2",
                    )}
                  >
                    <span className="size-3 shrink-0 rounded-full" style={{ background: g.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{g.label}</span>
                    <span className="text-sm font-extrabold text-ink tnum" data-testid={`response-${g.key}-count`}>
                      {formatNumber(n)}
                    </span>
                    <span className="w-10 text-right text-xs text-muted tnum">{people ? `${Math.round((100 * n) / people)}%` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- employees
function EmployeesTable({ rows, loading, picked, onPick }: { rows: EmployeeFollowups[]; loading: boolean; picked: string; onPick: (id: string) => void }) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card" data-testid="followup-employees">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-3 pt-5">
        <h3 className="text-base font-bold text-ink">Employees</h3>
        <span className="text-xs text-muted">late follow-ups first - click one to look only at them</span>
      </div>
      {loading ? (
        <Skeleton className="m-5 h-40" />
      ) : rows.length === 0 ? (
        <p className="px-5 pb-8 text-center text-sm text-muted">No calls or follow-ups in this period.</p>
      ) : (
        <TableWrap className="rounded-none border-0 border-t shadow-none">
          <Table className="min-w-[640px]">
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH className="text-right">People</TH>
                <TH className="text-right">Spoke</TH>
                <TH className="text-right">Interested</TH>
                <TH className="text-right">To call back</TH>
                <TH className="text-right">Late</TH>
              </TR>
            </THead>
            <tbody>
              {rows.map((r) => {
                const on = picked === String(r.id);
                return (
                  <TR key={r.id} interactive className={cn(on && "bg-brand-soft/40")} onClick={() => onPick(on ? "all" : String(r.id))} data-testid="followup-employee-row">
                    <TD className="max-w-[210px]">
                      <EmployeeCell id={r.id} name={r.full_name} subtitle={r.team_name ? `${r.team_name} · ${r.employee_code}` : r.employee_code} size="xs" linked={false} />
                    </TD>
                    <TD className="text-right font-semibold text-ink tnum">{formatNumber(r.people)}</TD>
                    <TD className="text-right text-ink-soft tnum">{formatNumber(r.spoken)}</TD>
                    <TD className="text-right text-ink-soft tnum">{formatNumber(r.responses.INTERESTED ?? 0)}</TD>
                    <TD className="text-right font-semibold text-ink tnum">{formatNumber(r.pending)}</TD>
                    <TD className="text-right tnum">{r.overdue > 0 ? <Badge tone="danger">{r.overdue}</Badge> : <span className="text-faint">0</span>}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- to call back
function FollowupRows({ items, loading, onOpen }: { items: FollowupItem[]; loading: boolean; onOpen: (item: FollowupItem) => void }) {
  const now = useNow(60_000);
  if (loading) return <Skeleton className="h-64 w-full" />;
  return (
    <TableWrap>
      <Table className="min-w-[900px]" data-testid="followup-table">
        <THead>
          <TR>
            <TH>Due</TH>
            <TH>Employee</TH>
            <TH>Person to call</TH>
            <TH>Why</TH>
            <TH>Before this</TH>
            <TH className="w-8" aria-label="Open" />
          </TR>
        </THead>
        <tbody>
          {items.map((f) => {
            const due = followupDue(f.status === "pending" ? f.scheduled_at : (f.completed_at ?? f.scheduled_at), f.status, now);
            return (
              <tr key={f.id} onClick={() => onOpen(f)} onKeyDown={(e) => e.key === "Enter" && onOpen(f)} tabIndex={0} data-testid="followup-row" className="group cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2 focus-visible:bg-surface-2">
                <TD>
                  <Badge tone={DUE_TONE[due.tone]} dot>
                    {due.label}
                  </Badge>
                  <p className="mt-1 text-[11px] text-muted">{due.detail}</p>
                </TD>
                <TD className="max-w-[190px]">
                  <EmployeeCell id={f.employee_id} name={f.employee_name} subtitle={f.team_name ?? undefined} size="xs" linked={false} />
                </TD>
                <TD className="max-w-[220px]">
                  <p className="truncate font-semibold text-ink">{f.contact_name}</p>
                  <p className="truncate text-xs text-muted tnum">{formatPhone(f.phone)}</p>
                </TD>
                <TD className="max-w-[240px]">
                  <p className="line-clamp-2 text-sm text-ink-soft">{f.note ?? <span className="text-faint">no note</span>}</p>
                </TD>
                <TD className="max-w-[260px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ResponseBadge code={f.response?.code} label={f.response?.label} />
                    <span className="text-xs text-muted">
                      {f.calls} call{f.calls === 1 ? "" : "s"}
                      {f.last_call_at ? ` · ${timeAgo(f.last_call_at)}` : ""}
                    </span>
                  </div>
                  {f.last_note ? <p className="mt-1 line-clamp-1 text-xs text-muted">&ldquo;{f.last_note.body}&rdquo;</p> : null}
                </TD>
                <TD className="pr-3 text-faint transition-colors group-hover:text-brand">
                  <ChevronRight className="size-4" />
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function FollowupsView() {
  const { range, label } = useRange();
  const [employee, setEmployee] = React.useState("all");
  const [group, setGroup] = React.useState("all");
  const [followup, setFollowup] = React.useState<"all" | "pending" | "overdue">("all");
  const [q, setQ] = React.useState("");
  const [tab, setTab] = React.useState("people");
  const [state, setState] = React.useState<FollowupState>("overdue");
  const search = useDebounced(q, 300).trim();
  const employeeId = employee === "all" ? null : Number(employee);
  const [openCall, setOpenCall] = useCallParam();
  const [talkRaw, setTalkRaw] = useUrlParam("talk");
  const talk = parseTalkKey(talkRaw);

  const employees = useEmployeeList({});
  const summary = useFollowupSummary(range, { employeeId });
  const [page, setPage] = usePageReset([range.from, range.to, employee, group, followup, search, tab, state]);

  const chosen = group === "all" ? undefined : groupByKey(group);
  const conversations = useConversations(range, { employeeId, response: chosen ? groupCodes(chosen) : undefined, followup: followup === "all" ? undefined : followup, q: search || undefined, page, pageSize: PAGE_SIZE });
  const list = useFollowupList(range, { state, employeeId, q: search || undefined, page, pageSize: PAGE_SIZE });

  const s = summary.data;
  const f = s?.followups;
  const loading = !s;
  const filtered = employee !== "all" || group !== "all" || followup !== "all" || search !== "";
  const clear = () => {
    setEmployee("all");
    setGroup("all");
    setFollowup("all");
    setQ("");
  };

  const rows = conversations.data?.items ?? [];
  const items = list.data?.items ?? [];
  const peopleTotal = conversations.data?.total ?? 0;
  const listTotal = list.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Follow-ups"
        description={
          <>
            Who the employees spoke to {label.toLowerCase()}, what each person answered, and who still has to be called back.
            {s ? <span className="ml-1 font-semibold text-ink-soft">{formatNumber(s.people)} people called.</span> : null}
          </>
        }
        actions={
          <Select value={employee} onValueChange={setEmployee}>
            <SelectTrigger className="w-52" aria-label="Employee" data-testid="followup-employee-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employees.data?.items.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {summary.isError && !s ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The follow-ups could not be loaded." onRetry={() => summary.refetch()} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="followup-kpis">
            <StatCard index={0} loading={loading} label="People called" icon={Users} tone="brand" value={s?.people ?? 0} caption={s ? `${formatNumber(s.calls)} calls, ${formatNumber(s.spoken)} people answered` : undefined} testId="fkpi-people" />
            <StatCard index={1} loading={loading} label="To call back" icon={CalendarClock} tone="violet" value={f?.pending ?? 0} caption="follow-ups still to do, from any day" testId="fkpi-pending" />
            <StatCard index={2} loading={loading} label="Overdue" icon={AlarmClock} tone="danger" value={f?.overdue ?? 0} caption="their time has passed" testId="fkpi-overdue" />
            <StatCard index={3} loading={loading} label="Due today" icon={Phone} tone="warn" value={f?.today ?? 0} caption={f ? `${formatNumber(f.upcoming)} after today` : undefined} testId="fkpi-today" />
            <StatCard index={4} loading={loading} label="Closed" icon={CalendarCheck} tone="teal" value={f?.closed ?? 0} caption={f ? `${formatNumber(f.created)} scheduled ${label.toLowerCase()}` : undefined} testId="fkpi-closed" />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <ResponseBreakdown responses={s?.responses} people={s?.people ?? 0} loading={loading} active={group} onPick={(key) => { setGroup(key); setTab("people"); }} />
            </div>
            <div className="xl:col-span-7">
              <EmployeesTable rows={s?.employees ?? []} loading={loading} picked={employee} onPick={setEmployee} />
            </div>
          </div>

          <Tabs value={tab} onValueChange={setTab} className="mt-8">
            <TabsList>
              <TabsTrigger value="people" active={tab === "people"} group="fu" count={tab === "people" ? peopleTotal : undefined}>
                <MessagesSquare className="size-4" /> Who they spoke to
              </TabsTrigger>
              <TabsTrigger value="callback" active={tab === "callback"} group="fu" count={tab === "callback" ? listTotal : undefined}>
                <CalendarClock className="size-4" /> To call back
              </TabsTrigger>
            </TabsList>

            <div className="my-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "people" ? "Search name or number" : "Search person or employee"} className="pl-10 pr-9" aria-label="Search" data-testid="followup-search" />
                {q ? (
                  <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3" aria-label="Clear search">
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              {tab === "people" ? (
                <>
                  <Select value={group} onValueChange={setGroup}>
                    <SelectTrigger className="w-56" aria-label="Response" data-testid="followup-response-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any response</SelectItem>
                      {RESPONSE_GROUPS.map((g) => (
                        <SelectItem key={g.key} value={g.key}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Segmented
                    name="followup-has"
                    size="sm"
                    value={followup}
                    onChange={setFollowup}
                    aria-label="Follow-up"
                    options={[
                      { value: "all", label: "Any" },
                      { value: "pending", label: "Has follow-up" },
                      { value: "overdue", label: "Overdue" },
                    ]}
                  />
                </>
              ) : (
                <Segmented
                  name="followup-state"
                  size="sm"
                  value={state}
                  onChange={setState}
                  aria-label="Which follow-ups"
                  options={[
                    { value: "overdue", label: `Overdue${f ? ` (${f.overdue})` : ""}` },
                    { value: "today", label: `Today${f ? ` (${f.today})` : ""}` },
                    { value: "upcoming", label: `Later${f ? ` (${f.upcoming})` : ""}` },
                    { value: "closed", label: "Done" },
                  ]}
                />
              )}
              {filtered ? (
                <Button variant="ghost" size="sm" onClick={clear}>
                  <X className="size-4" /> Clear filters
                </Button>
              ) : null}
            </div>

            <TabsContent value="people">
              {conversations.isError && !conversations.data ? (
                <div className="rounded-2xl border border-line bg-surface shadow-card">
                  <ErrorState message="The list could not be loaded." onRetry={() => conversations.refetch()} />
                </div>
              ) : (
                <>
                  <ConversationsTable rows={rows} loading={conversations.isPending} onOpen={(r) => setTalkRaw(talkKey(r.employee_id, r.phone))} dimmed={conversations.isFetching && !conversations.isPending} />
                  {!conversations.isPending && rows.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
                      <NoConversations filtered={filtered} />
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <Pagination page={page} pageSize={PAGE_SIZE} total={peopleTotal} onPage={setPage} />
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="callback">
              {list.isError && !list.data ? (
                <div className="rounded-2xl border border-line bg-surface shadow-card">
                  <ErrorState message="The follow-ups could not be loaded." onRetry={() => list.refetch()} />
                </div>
              ) : (
                <>
                  <FollowupRows items={items} loading={list.isPending} onOpen={(item) => setTalkRaw(talkKey(item.employee_id, item.phone))} />
                  {!list.isPending && items.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-line bg-surface p-12 text-center shadow-card">
                      <p className="text-base font-bold text-ink">{state === "closed" ? "No follow-up was closed in this period" : "Nothing to call back here"}</p>
                      <p className="mt-1 text-sm text-muted">{state === "overdue" ? "Nobody is late - every follow-up is still ahead of its time." : "Follow-ups appear when an employee asks a person to be called back."}</p>
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <Pagination page={page} pageSize={PAGE_SIZE} total={listTotal} onPage={setPage} />
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <p className="mt-6 flex items-center gap-1.5 px-1 text-xs text-muted">
        <CalendarClock className="size-3.5" /> A person&apos;s response is the outcome the employee chose after the latest call that has one. Times are in the business time zone. Open a row to see every call, note and recording.
      </p>

      <ConversationDrawer target={talk} onClose={() => setTalkRaw(null)} onOpenCall={setOpenCall} />
      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}

