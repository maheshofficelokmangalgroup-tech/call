"use client";

import { Headphones } from "lucide-react";
import * as React from "react";

import { CallDrawer } from "@/components/domain/call-drawer";
import { CallFiltersBar, useCallFilterState } from "@/components/domain/call-filters";
import { NoCalls } from "@/components/domain/calls-table";
import { ChartCard } from "@/components/domain/chart-card";
import { RecordingCoverage } from "@/components/domain/recording-coverage";
import { RecordingRow } from "@/components/domain/recording-row";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useKeyedState, usePageReset } from "@/lib/hooks";
import { useCalls, useMe, useOverview } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { useCallParam } from "@/lib/use-call-param";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 15;

export function RecordingsView() {
  const { range, label } = useRange();
  const me = useMe();
  const canDownload = me.data?.employee.role === "admin";
  const overview = useOverview(range);
  const { state, filters, patch, reset, active } = useCallFilterState({ recording: "yes" });
  const [page, setPage] = usePageReset([filters, range.from, range.to]);
  const [expanded, setExpanded] = useKeyedState<number | null>(null, JSON.stringify([page, filters]));
  const [openCall, setOpenCall] = useCallParam();

  const calls = useCalls(range, { ...filters, hasRecording: true, page, pageSize: PAGE_SIZE });
  const items = (calls.data?.items ?? []).filter((c) => c.recording);
  const total = calls.data?.total ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Calling" title="Recordings" description={<>Listen to the calls of {label.toLowerCase()}. Press play to hear a call, or open it for the full details.</>} />

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="order-2 lg:order-1 lg:col-span-8">
          <CallFiltersBar state={state} patch={patch} onClear={reset} active={active} showRecording={false} />

          {calls.isError && !calls.data ? (
            <div className="rounded-2xl border border-line bg-surface shadow-card">
              <ErrorState message="The recordings could not be loaded." onRetry={() => calls.refetch()} />
            </div>
          ) : calls.isPending ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-2xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface shadow-card">
              {active ? (
                <NoCalls filtered />
              ) : (
                <div className="flex flex-col items-center px-6 py-14 text-center">
                  <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-muted">
                    <Headphones className="size-6" />
                  </span>
                  <p className="text-base font-bold text-ink">No recordings in this period</p>
                  <p className="mt-1 max-w-md text-sm text-muted">Recordings appear here after a recorded call is uploaded by the employee&apos;s phone. See the box on the right for why some calls cannot be recorded.</p>
                </div>
              )}
            </div>
          ) : (
            <ul className={cn("space-y-3 transition-opacity", calls.isFetching && "opacity-70")} data-testid="recording-list">
              {items.map((call) => (
                <RecordingRow key={call.id} call={call} expanded={expanded === call.id} onToggle={() => setExpanded((cur) => (cur === call.id ? null : call.id))} onOpen={() => setOpenCall(call.id)} canDownload={canDownload} />
              ))}
            </ul>
          )}

          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        </div>

        <aside className="order-1 lg:order-2 lg:col-span-4">
          <ChartCard title="Recording coverage" description="How many answered calls were recorded." testId="recording-coverage">
            {overview.data ? <RecordingCoverage insight={overview.data.recording} /> : <Skeleton className="h-64 w-full" />}
          </ChartCard>
        </aside>
      </div>

      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
