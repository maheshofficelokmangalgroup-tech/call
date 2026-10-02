"use client";

import { BadgeCheck, BookUser, Clock, Headphones, Hourglass, PhoneCall, PhoneIncoming, Users } from "lucide-react";
import * as React from "react";

import { ActivityChart, ActivityToggle, type ActivityMetric } from "@/components/charts/activity-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { HourlyChart } from "@/components/charts/hourly-chart";
import { OutcomeDonut } from "@/components/charts/outcome-donut";
import { CallDrawer } from "@/components/domain/call-drawer";
import { ChartCard } from "@/components/domain/chart-card";
import { Leaderboard } from "@/components/domain/leaderboard";
import { LivePanel, RecentCalls } from "@/components/domain/live-panel";
import { RecordingCoverage } from "@/components/domain/recording-coverage";
import { StatCard } from "@/components/domain/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useMe, useOverview, useTeams } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { useCallParam } from "@/lib/use-call-param";
import { cn, formatDuration, formatNumber, formatPercent } from "@/lib/utils";

function greeting(tz: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
  return hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return <Skeleton className="w-full" style={{ height }} />;
}

export function DashboardView() {
  const me = useMe();
  const { range, label, days, tz } = useRange();
  const teams = useTeams();
  const [teamId, setTeamId] = React.useState<number | null>(null);
  const [metric, setMetric] = React.useState<ActivityMetric>("calls");
  const [openCall, setOpenCall] = useCallParam();
  const overview = useOverview(range, { teamId });

  const user = me.data?.employee;
  const isAdmin = user?.role === "admin";
  const data = overview.data;
  const loading = !data;
  const refreshing = overview.isPlaceholderData || (overview.isFetching && !overview.isPending);
  const t = data?.totals;
  const prev = data?.previous;
  const series = data?.series ?? [];
  const singleDay = days === 1;

  return (
    <div>
      <PageHeader
        eyebrow="Dashboard"
        title={`${greeting(tz)}${user ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description={
          <>
            What your team did <span className="font-semibold text-ink-soft">{label.toLowerCase()}</span>.
          </>
        }
        actions={
          isAdmin && (teams.data?.length ?? 0) > 0 ? (
            <Select value={teamId === null ? "all" : String(teamId)} onValueChange={(v) => setTeamId(v === "all" ? null : Number(v))}>
              <SelectTrigger className="w-48" aria-label="Team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.data?.map((team) => (
                  <SelectItem key={team.id} value={String(team.id)}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {overview.isError && !data ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The numbers could not be loaded." onRetry={() => overview.refetch()} />
        </div>
      ) : (
        <div className={cn("space-y-5 transition-opacity duration-300", refreshing && "opacity-70")}>
          {/* headline numbers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis">
            <StatCard index={0} loading={loading} label="Calls made" icon={PhoneCall} tone="brand" value={t?.calls ?? 0} previous={prev?.calls} trend={series.map((d) => d.calls)} caption={t ? `${formatNumber(t.unique_contacts)} different people called` : undefined} testId="kpi-calls" />
            <StatCard index={1} loading={loading} label="Answered" icon={PhoneIncoming} tone="info" value={t?.connected ?? 0} previous={prev?.connected} trend={series.map((d) => d.connected)} caption={t ? `${formatPercent(t.answer_rate, 1)} of calls were picked up` : undefined} testId="kpi-answered" />
            <StatCard index={2} loading={loading} label="Talk time" icon={Clock} tone="violet" value={t?.talk_seconds ?? 0} format={(n) => formatDuration(n, { compact: true })} previous={prev?.talk_seconds} trend={series.map((d) => d.talk_seconds)} caption={t ? `longest call ${formatDuration(t.longest_call_seconds, { compact: true })}` : undefined} testId="kpi-talk" />
            <StatCard index={3} loading={loading} label="Average conversation" icon={BadgeCheck} tone="teal" value={t?.avg_talk_seconds ?? 0} format={(n) => formatDuration(n, { compact: true })} previous={prev?.avg_talk_seconds} caption={t ? `rings ${formatDuration(t.avg_ring_seconds)} before it is picked up` : undefined} testId="kpi-avg" />
            <StatCard index={4} loading={loading} label="Employees calling" icon={Users} tone="pink" value={t?.active_employees ?? 0} previous={prev?.active_employees} caption={data ? `of ${formatNumber(data.employees.active)} active accounts` : undefined} testId="kpi-people" />
            <StatCard index={5} loading={loading} label="People reached" icon={BookUser} tone="info" value={t?.unique_contacts ?? 0} previous={prev?.unique_contacts} caption="different phone numbers dialled" testId="kpi-contacts" />
            <StatCard index={6} loading={loading} label="Recordings" icon={Headphones} tone="brand" value={t?.recordings ?? 0} previous={prev?.recordings} caption={data ? `${formatPercent(data.recording.coverage_percent)} of answered calls` : undefined} testId="kpi-recordings" />
            <StatCard index={7} loading={loading} label="Waiting for an outcome" icon={Hourglass} tone="warn" inverse value={t?.pending_wrapup ?? 0} previous={prev?.pending_wrapup} caption="calls the employee has not wrapped up" testId="kpi-wrapup" />
          </div>

          {/* right now */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <LivePanel onOpenCall={setOpenCall} />
            </div>
            <div className="lg:col-span-5">
              <RecentCalls onOpenCall={setOpenCall} />
            </div>
          </div>

          {/* trends */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {singleDay ? (
              <ChartCard className="lg:col-span-8" title="Calls through the day" description="One bar for every hour of the selected day." delay={0.1}>
                {loading ? <ChartSkeleton /> : <HourlyChart hourly={data.hourly} minHeight={300} />}
              </ChartCard>
            ) : (
              <ChartCard
                className="lg:col-span-8"
                title="Activity"
                description={metric === "calls" ? "Calls made every day, and how many of them were answered." : "Minutes spent talking every day."}
                actions={<ActivityToggle metric={metric} onChange={setMetric} />}
                delay={0.1}
                testId="chart-activity"
              >
                {loading ? <ChartSkeleton /> : <ActivityChart series={series} metric={metric} />}
              </ChartCard>
            )}
            <ChartCard className="lg:col-span-4" title="How calls ended" description="The outcome the employee chose after each call." delay={0.15}>
              {loading ? <ChartSkeleton height={200} /> : <OutcomeDonut outcomes={data.outcomes} />}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <ChartCard className="lg:col-span-5" title="Top callers" description="Who made the most calls in this period." delay={0.2}>
              {loading ? <ChartSkeleton height={320} /> : <Leaderboard people={data.leaderboard} />}
            </ChartCard>
            {singleDay ? (
              <ChartCard className="lg:col-span-7" title="Recordings" description="Calls that have a recording you can play." delay={0.25} testId="recording-coverage">
                {loading ? <ChartSkeleton height={260} /> : <RecordingCoverage insight={data.recording} />}
              </ChartCard>
            ) : (
              <ChartCard className="lg:col-span-7" title="Busiest hours" description="When in the day your team calls the most." delay={0.25}>
                {loading ? <ChartSkeleton height={260} /> : <HourlyChart hourly={data.hourly} />}
              </ChartCard>
            )}
          </div>

          {!singleDay ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <ChartCard className="lg:col-span-7" title="Weekly rhythm" description="Calls by weekday and hour - the darker the square, the busier the time." delay={0.3}>
                {loading ? <ChartSkeleton height={260} /> : <Heatmap values={data.heatmap} />}
              </ChartCard>
              <ChartCard className="lg:col-span-5" title="Recordings" description="Calls that have a recording you can play." delay={0.35} testId="recording-coverage">
                {loading ? <ChartSkeleton height={260} /> : <RecordingCoverage insight={data.recording} />}
              </ChartCard>
            </div>
          ) : null}
        </div>
      )}

      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
