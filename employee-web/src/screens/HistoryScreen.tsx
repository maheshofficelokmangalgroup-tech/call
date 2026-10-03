import { useMemo } from "react";
import { useSearchParams } from "react-router";

import { Button } from "@/components/Button";
import { CallRow } from "@/components/CallRow";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { RowSkeleton } from "@/components/Skeleton";
import { SyncBanner } from "@/components/SyncBanner";
import { Text } from "@/components/Text";
import { hasRecording, isConnected, type CallRowModel } from "@/lib/callModels";
import { isOffline, useHistory } from "@/lib/queries";
import { formatDayLabel } from "@/lib/time";

type Filter = "all" | "connected" | "missed" | "pending" | "recordings";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "connected", label: "Connected" },
  { key: "missed", label: "Not answered" },
  { key: "pending", label: "Needs outcome" },
  { key: "recordings", label: "Recordings" },
];

function parseFilter(value: string | null): Filter {
  return FILTERS.some((f) => f.key === value) ? (value as Filter) : "all";
}

function group(rows: CallRowModel[]): { title: string; data: CallRowModel[] }[] {
  const sections: { title: string; data: CallRowModel[] }[] = [];
  for (const row of rows) {
    const title = formatDayLabel(row.startedAt);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(row);
    else sections.push({ title, data: [row] });
  }
  return sections;
}

export function HistoryScreen() {
  // the filter lives in the address (?filter=connected), so the cards on Home can open this page already filtered
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get("filter"));
  const history = useHistory();
  const rows = history.rows;

  const setFilter = (next: Filter) => setParams(next === "all" ? {} : { filter: next }, { replace: true });

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const connected = isConnected(r);
        if (filter === "connected") return connected;
        if (filter === "missed") return !connected && (r.status === "no_answer" || r.status === "failed");
        if (filter === "pending") return r.needsOutcome;
        if (filter === "recordings") return hasRecording(r);
        return true;
      }),
    [rows, filter],
  );
  const sections = useMemo(() => group(filtered), [filtered]);
  const pendingCount = rows.filter((r) => r.needsOutcome).length;
  const recordingCount = rows.filter(hasRecording).length;

  return (
    <div className="page">
      <div className="page-top">
        <Text variant="title" as="h1" className="page-title">
          Call history
        </Text>
        <div className="chips" role="group" aria-label="Filter calls">
          {FILTERS.map((f) => {
            const count = f.key === "pending" ? pendingCount : f.key === "recordings" ? recordingCount : 0;
            return <Chip key={f.key} label={count ? `${f.label} (${count})` : f.label} selected={filter === f.key} onClick={() => setFilter(f.key)} size="sm" testId={`history-filter-${f.key}`} />;
          })}
        </div>
      </div>

      <SyncBanner offline={isOffline(history)} onRetry={() => void history.refetch()} />

      {history.isPending ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : sections.length === 0 ? (
        <EmptyState
          icon={filter === "recordings" ? "headphones" : "history"}
          title={filter === "recordings" ? "No recordings yet" : "No calls yet"}
          message={
            filter === "all"
              ? "Calls you make will be listed here with their outcome."
              : filter === "recordings"
                ? "A recorded call shows a headphones icon here and a play button on its details page. Calls made from the web app are not recorded."
                : "No calls match this filter."
          }
        />
      ) : (
        sections.map((section) => (
          <section key={section.title}>
            <Text variant="smallMedium" color="muted" className="section-label" as="h2">
              {section.title}
            </Text>
            {section.data.map((row) => (
              <CallRow key={row.key} row={row} />
            ))}
          </section>
        ))
      )}
      {history.hasNextPage ? <Button title={history.isFetchingNextPage ? "Loading..." : "Load older calls"} variant="soft" size="md" onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage} className="load-more" /> : null}
    </div>
  );
}
