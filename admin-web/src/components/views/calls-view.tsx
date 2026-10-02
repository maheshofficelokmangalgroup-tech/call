"use client";

import { Download, PhoneCall } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { CallDrawer } from "@/components/domain/call-drawer";
import { CallFiltersBar, useCallFilterState } from "@/components/domain/call-filters";
import { CallsTable, NoCalls } from "@/components/domain/calls-table";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { ErrorState } from "@/components/ui/states";
import { downloadUrl } from "@/lib/api";
import { usePageReset } from "@/lib/hooks";
import { callParams, useCalls } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { useCallParam } from "@/lib/use-call-param";
import { formatNumber } from "@/lib/utils";

const PAGE_SIZE = 25;

export function CallsView() {
  const { range, label } = useRange();
  const search = useSearchParams();
  const initialEmployee = search.get("employee");
  const filterState = useCallFilterState({ employee: initialEmployee && /^\d+$/.test(initialEmployee) ? initialEmployee : "all" });
  const { state, filters, patch, reset, active } = filterState;
  const [page, setPage] = usePageReset([filters, range.from, range.to]);
  const [openCall, setOpenCall] = useCallParam();

  const calls = useCalls(range, { ...filters, page, pageSize: PAGE_SIZE });
  const items = calls.data?.items ?? [];
  const total = calls.data?.total ?? 0;

  const exportHref = downloadUrl("calls/export.csv", callParams(range, filters));

  return (
    <div>
      <PageHeader
        eyebrow="Calling"
        title="Calls"
        description={
          <>
            Every call made {label.toLowerCase()}: who called whom, when, for how long, and how it ended.
            {calls.data ? <span className="ml-1 font-semibold text-ink-soft">{formatNumber(total)} found.</span> : null}
          </>
        }
        actions={
          <Button asChild variant="secondary">
            <a href={exportHref} download data-testid="export-calls">
              <Download className="size-4" /> Export CSV
            </a>
          </Button>
        }
      />

      <CallFiltersBar state={state} patch={patch} onClear={reset} active={active} />

      {calls.isError && !calls.data ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The calls could not be loaded." onRetry={() => calls.refetch()} />
        </div>
      ) : (
        <>
          <CallsTable calls={items} loading={calls.isPending} onOpen={setOpenCall} dimmed={calls.isFetching && !calls.isPending} />
          {!calls.isPending && items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
              <NoCalls filtered={active} />
            </div>
          ) : null}
          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        </>
      )}

      <p className="mt-4 flex items-center gap-1.5 px-1 text-xs text-muted">
        <PhoneCall className="size-3.5" /> Times are shown in the business time zone. Open a call to hear its recording and see the full timeline.
      </p>

      <CallDrawer callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}
