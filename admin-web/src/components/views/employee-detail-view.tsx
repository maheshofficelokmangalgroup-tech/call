"use client";

import { ArrowLeft, BadgeCheck, BookUser, CalendarDays, Clock, Headphones, Mail, PhoneCall, PhoneIncoming, Smartphone, UserRoundX } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import * as React from "react";

import { ActivityChart, ActivityToggle, type ActivityMetric } from "@/components/charts/activity-chart";
import { HourlyChart } from "@/components/charts/hourly-chart";
import { OutcomeDonut } from "@/components/charts/outcome-donut";
import { CallDrawer } from "@/components/domain/call-drawer";
import { CallFiltersBar, useCallFilterState } from "@/components/domain/call-filters";
import { CallsTable, NoCalls } from "@/components/domain/calls-table";
import { ChartCard } from "@/components/domain/chart-card";
import { DevicesPanel } from "@/components/domain/devices-panel";
import { EmployeeActions } from "@/components/domain/employee-actions";
import { RecordingCoverage } from "@/components/domain/recording-coverage";
import { RecordingRow } from "@/components/domain/recording-row";
import { StatCard } from "@/components/domain/stat-card";
import { TargetRing } from "@/components/domain/target-ring";
import { WorkingWindow } from "@/components/domain/working-window";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { PRESENCE_META, PresenceLabel } from "@/components/ui/presence";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import { useKeyedState, usePageReset } from "@/lib/hooks";
import { useCalls, useEmployeeDetail, useMe } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { outcomeTone } from "@/lib/status";
import type { ContactStat } from "@/lib/types";
import { useCallParam } from "@/lib/use-call-param";
import { cn, formatDateTime, formatDuration, formatNumber, formatPercent, formatPhone, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 20;

function InfoItem({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <div className="truncate text-sm font-semibold text-ink">{children}</div>
      </div>
    </div>
  );
}

function PeopleTable({ people, onSeeCalls }: { people: ContactStat[]; onSeeCalls: (phone: string) => void }) {
  if (people.length === 0) return <p className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-8 text-center text-sm text-muted">This person has not called anyone in this period.</p>;
  return (
    <TableWrap>
      <Table className="min-w-[760px]" data-testid="people-table">
        <THead>
          <TR>
            <TH>Person called</TH>
            <TH className="text-right">Calls</TH>
            <TH className="text-right">Answered</TH>
            <TH className="text-right">Talk time</TH>
            <TH>Last call</TH>
            <TH>Last outcome</TH>
            <TH className="w-24" aria-label="Open" />
          </TR>
        </THead>
        <tbody>
          {people.map((c) => (
            <TR key={c.phone}>
              <TD>
                <p className="font-semibold text-ink">{c.name ?? formatPhone(c.phone)}</p>
                {c.name ? <p className="text-xs text-muted tnum">{formatPhone(c.phone)}</p> : <p className="text-xs text-faint">dialled by hand</p>}
              </TD>
              <TD className="text-right font-bold text-ink tnum">{formatNumber(c.calls)}</TD>
              <TD className="text-right text-ink-soft tnum">{formatNumber(c.connected)}</TD>
              <TD className="text-right font-semibold text-ink tnum">{c.talk_seconds > 0 ? formatDuration(c.talk_seconds, { compact: true }) : "-"}</TD>
              <TD className="whitespace-nowrap text-ink-soft">{timeAgo(c.last_call_at)}</TD>
              <TD>{c.last_outcome ? <Badge tone={outcomeTone(c.last_outcome.toUpperCase().replace(/[^A-Z]+/g, "_"))}>{c.last_outcome}</Badge> : <span className="text-faint">-</span>}</TD>
              <TD className="text-right">
                <Button variant="ghost" size="xs" onClick={() => onSeeCalls(c.phone)}>
                  Calls
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function EmployeeDetailView({ id }: { id: number }) {
  const { range, label, days } = useRange();
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const detail = useEmployeeDetail(id, range);
  const [tab, setTab] = React.useState("calls");
  const [metric, setMetric] = React.useState<ActivityMetric>("calls");
  const [openCall, setOpenCall] = useCallParam();
  const filterState = useCallFilterState({ employee: String(id) });
  const { state, filters, patch, reset, active } = filterState;
  const [page, setPage] = usePageReset([filters, range.from, range.to, tab]);
  const [expanded, setExpanded] = useKeyedState<number | null>(null, JSON.stringify([page, filters, tab]));

  const callsQuery = useCalls(range, { ...filters, employeeId: id, hasRecording: tab === "recordings" ? true : filters.hasRecording, page, pageSize: PAGE_SIZE });
  const items = callsQuery.data?.items ?? [];
  const total = callsQuery.data?.total ?? 0;

  if (detail.isError && !detail.data) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div>
        <Link href="/employees" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> Employees
        </Link>
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState title={missing ? "This employee does not exist" : "Could not load this employee"} message={missing ? "The account may have been removed, or the link is wrong." : "Check your connection and try again."} onRetry={missing ? undefined : () => detail.refetch()} />
        </div>
      </div>
    );
  }

  const data = detail.data;
  const m = data?.employee;
  const loading = !data || !m;
  const lastDevice = data?.devices[0];

  return (
    <div>
      <Link href="/employees" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> Employees
      </Link>

      {/* who */}
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="mb-5 overflow-hidden rounded-3xl border border-line bg-surface shadow-card" data-testid="employee-hero">
        <div className="mesh relative h-24">
          <div className="grid-fade absolute inset-0 opacity-50" aria-hidden />
        </div>
        <div className="px-5 pb-6 sm:px-8">
          {loading ? (
            <div className="flex items-start gap-5">
              <Skeleton className="-mt-10 size-20 shrink-0 rounded-full ring-4 ring-surface" />
              <div className="space-y-2 pt-3">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-5 w-72" />
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                <div className="relative -mt-10 shrink-0">
                  <Avatar name={m.full_name} size="xl" className="ring-4 ring-surface" />
                  <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-surface" title={PRESENCE_META[m.presence].label}>
                    <span className={cn("size-3.5 rounded-full", PRESENCE_META[m.presence].dot)} />
                  </span>
                </div>
                <div className="min-w-0 flex-1 basis-60 pt-3">
                  <h1 className="truncate text-2xl font-extrabold tracking-tight text-ink sm:text-3xl" data-testid="employee-name">
                    {m.full_name}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="brand" className="capitalize">
                      {m.role}
                    </Badge>
                    <Badge tone="outline">{m.team_name ?? "No team"}</Badge>
                    <Badge tone="neutral" className="font-mono">
                      {m.employee_code}
                    </Badge>
                    {!m.is_active ? <Badge tone="danger">Deactivated</Badge> : null}
                    {m.must_change_password ? <Badge tone="warn">Has not changed the first password</Badge> : null}
                  </div>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-2 pt-3">
                    <EmployeeActions employee={m} showOpen={false} trigger={<Button variant="secondary">Manage</Button>} />
                  </div>
                ) : null}
              </div>
              <div className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem icon={Mail} label="Email">
                  {m.email}
                </InfoItem>
                <InfoItem icon={PhoneCall} label="Mobile">
                  {m.phone ? formatPhone(m.phone) : <span className="font-medium text-faint">not added</span>}
                </InfoItem>
                <InfoItem icon={Clock} label="Activity">
                  <PresenceLabel presence={m.presence} className="text-sm" />
                  <span className="ml-1 text-xs font-medium text-muted">{m.presence === "on_call" ? "" : m.last_seen_at ? `· ${timeAgo(m.last_seen_at)}` : "· never signed in"}</span>
                </InfoItem>
                <InfoItem icon={Smartphone} label="Phone">
                  {lastDevice ? `${lastDevice.device_name ?? "Unknown"} · app ${lastDevice.app_version ?? "?"}` : <span className="font-medium text-faint">no phone yet</span>}
                </InfoItem>
              </div>
            </>
          )}
        </div>
      </motion.section>

      {/* numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" data-testid="employee-kpis">
        <StatCard index={0} loading={loading} label="Calls made" icon={PhoneCall} tone="brand" value={m?.calls ?? 0} caption={m ? `on ${m.active_days} of ${days} days` : undefined} testId="ekpi-calls" />
        <StatCard index={1} loading={loading} label="Answered" icon={PhoneIncoming} tone="info" value={m?.connected ?? 0} caption={m ? `${formatPercent(m.answer_rate, 1)} answer rate` : undefined} />
        <StatCard index={2} loading={loading} label="Talk time" icon={Clock} tone="violet" value={m?.talk_seconds ?? 0} format={(n) => formatDuration(n, { compact: true })} caption={m ? `longest ${formatDuration(m.longest_call_seconds, { compact: true })}` : undefined} testId="ekpi-talk" />
        <StatCard index={3} loading={loading} label="Average call" icon={BadgeCheck} tone="teal" value={m?.avg_talk_seconds ?? 0} format={(n) => formatDuration(n, { compact: true })} caption="talk time per answered call" />
        <StatCard index={4} loading={loading} label="People reached" icon={BookUser} tone="pink" value={m?.unique_contacts ?? 0} caption="different phone numbers" />
        <StatCard index={5} loading={loading} label="Recordings" icon={Headphones} tone="warn" value={m?.recordings ?? 0} caption={data ? `${formatPercent(data.recording.coverage_percent)} of answered calls` : undefined} />
      </div>

      {/* today + working pattern */}
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <ChartCard className="lg:col-span-5" title="Today" description="Calls made since midnight against the daily target." delay={0.1}>
          {loading ? <Skeleton className="h-40 w-full" /> : <TargetRing calls={m.today_calls} target={m.daily_target} />}
        </ChartCard>
        <ChartCard className="lg:col-span-7" title="Working hours" description={`When ${m?.full_name.split(" ")[0] ?? "this person"} usually makes the first and the last call of a day.`} delay={0.15}>
          {loading ? <Skeleton className="h-40 w-full" /> : <WorkingWindow firstMinute={m.avg_first_call_minute} lastMinute={m.avg_last_call_minute} />}
        </ChartCard>
      </div>

      {/* charts */}
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <ChartCard
          className="lg:col-span-8"
          title="Activity"
          description={metric === "calls" ? "Calls made every day, and how many were answered." : "Minutes spent talking every day."}
          actions={<ActivityToggle metric={metric} onChange={setMetric} />}
          delay={0.2}
        >
          {loading ? <Skeleton className="h-[300px] w-full" /> : <ActivityChart series={data.series} metric={metric} />}
        </ChartCard>
        <ChartCard className="lg:col-span-4" title="How calls ended" description="The outcome chosen after each call." delay={0.25}>
          {loading ? <Skeleton className="h-[260px] w-full" /> : <OutcomeDonut outcomes={data.outcomes} />}
        </ChartCard>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <ChartCard className="lg:col-span-7" title="Busiest hours" description="When in the day the calls were made." delay={0.3}>
          {loading ? <Skeleton className="h-[260px] w-full" /> : <HourlyChart hourly={data.hourly} />}
        </ChartCard>
        <ChartCard className="lg:col-span-5" title="Recordings" description="Calls with a recording you can play." delay={0.35}>
          {loading ? <Skeleton className="h-[260px] w-full" /> : <RecordingCoverage insight={data.recording} />}
        </ChartCard>
      </div>

      {/* details */}
      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="calls" active={tab === "calls"} group="emp" count={m?.calls}>
            <PhoneCall className="size-4" /> Calls
          </TabsTrigger>
          <TabsTrigger value="people" active={tab === "people"} group="emp" count={data?.top_contacts.length}>
            <BookUser className="size-4" /> People called
          </TabsTrigger>
          <TabsTrigger value="recordings" active={tab === "recordings"} group="emp" count={m?.recordings}>
            <Headphones className="size-4" /> Recordings
          </TabsTrigger>
          <TabsTrigger value="phones" active={tab === "phones"} group="emp" count={data?.devices.length}>
            <Smartphone className="size-4" /> Phones &amp; sign-ins
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calls">
          <CallFiltersBar state={state} patch={patch} onClear={reset} active={active} showEmployee={false} />
          <CallsTable calls={items} loading={callsQuery.isPending} showEmployee={false} onOpen={setOpenCall} dimmed={callsQuery.isFetching && !callsQuery.isPending} />
          {!callsQuery.isPending && items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
              <NoCalls filtered={active} />
            </div>
          ) : null}
          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        </TabsContent>

        <TabsContent value="people">
          <p className="mb-3 text-sm text-muted">The people this employee called most {label.toLowerCase()}.</p>
          {loading ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <PeopleTable
              people={data.top_contacts}
              onSeeCalls={(phone) => {
                patch({ q: phone.replace(/^\+/, "") });
                setTab("calls");
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="recordings">
          {callsQuery.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-2xl" />
              ))}
            </div>
          ) : items.filter((c) => c.recording).length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface shadow-card">
              <NoCalls filtered={active} />
            </div>
          ) : (
            <ul className="space-y-3" data-testid="employee-recordings">
              {items
                .filter((c) => c.recording)
                .map((call) => (
                  <RecordingRow key={call.id} call={call} showEmployee={false} expanded={expanded === call.id} onToggle={() => setExpanded((cur) => (cur === call.id ? null : call.id))} onOpen={() => setOpenCall(call.id)} canDownload={isAdmin} />
                ))}
            </ul>
          )}
          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        </TabsContent>

        <TabsContent value="phones">
          {loading ? <Skeleton className="h-48 w-full" /> : <DevicesPanel employeeId={id} employeeName={m.full_name} devices={data.devices} bound={m.device_binding_enabled} isAdmin={isAdmin} />}
        </TabsContent>
      </Tabs>

      <p className="mt-8 flex items-center gap-1.5 px-1 text-xs text-muted">
        <CalendarDays className="size-3.5" /> Figures are for {label.toLowerCase()}
        {m ? ` · account created ${formatDateTime(m.created_at)}` : ""}
        {m && !m.is_active ? (
          <span className="ml-2 inline-flex items-center gap-1 font-semibold text-danger">
            <UserRoundX className="size-3.5" /> deactivated
          </span>
        ) : null}
      </p>

      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
