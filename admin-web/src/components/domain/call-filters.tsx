"use client";

import { Search, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounced } from "@/lib/hooks";
import { useEmployeeList, useMe, type CallFilters } from "@/lib/queries";

export interface CallFilterState {
  q: string;
  status: string;
  outcome: string;
  recording: "any" | "yes" | "no";
  duration: string;
  sort: "newest" | "oldest" | "longest";
  employee: string;
}

export const EMPTY_CALL_FILTERS: CallFilterState = { q: "", status: "all", outcome: "all", recording: "any", duration: "any", sort: "newest", employee: "all" };

/** The filters a person has set, and the same filters in the shape the API wants (the search text is sent a moment after typing stops). */
export function useCallFilterState(initial: Partial<CallFilterState> = {}) {
  const [state, setState] = React.useState<CallFilterState>({ ...EMPTY_CALL_FILTERS, ...initial });
  const q = useDebounced(state.q, 300);
  const filters = React.useMemo<CallFilters>(
    () => ({
      employeeId: state.employee === "all" ? null : Number(state.employee),
      status: state.status === "all" ? undefined : state.status,
      disposition: state.outcome === "all" ? undefined : state.outcome,
      hasRecording: state.recording === "any" ? undefined : state.recording === "yes",
      minDuration: state.duration === "any" ? undefined : Number(state.duration),
      q: q.trim() || undefined,
      sort: state.sort,
    }),
    [state, q],
  );
  const patch = React.useCallback((next: Partial<CallFilterState>) => setState((s) => ({ ...s, ...next })), []);
  const reset = React.useCallback(() => setState((s) => ({ ...EMPTY_CALL_FILTERS, sort: s.sort, employee: initial.employee ?? "all", recording: initial.recording ?? "any" })), [initial.employee, initial.recording]);
  const active =
    state.q !== "" || state.status !== "all" || state.outcome !== "all" || state.duration !== "any" || (state.recording !== (initial.recording ?? "any")) || (state.employee !== (initial.employee ?? "all"));
  return { state, filters, patch, reset, active };
}

const STATUS_OPTIONS = [
  { value: "all", label: "Any result" },
  { value: "completed", label: "Answered" },
  { value: "no_answer", label: "Not answered" },
  { value: "failed", label: "Failed" },
  { value: "connected", label: "In progress" },
];

const DURATION_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "10", label: "10 s or more" },
  { value: "30", label: "30 s or more" },
  { value: "60", label: "1 min or more" },
  { value: "180", label: "3 min or more" },
  { value: "300", label: "5 min or more" },
];

export function CallFiltersBar({
  state,
  patch,
  onClear,
  active,
  showEmployee = true,
  showRecording = true,
}: {
  state: CallFilterState;
  patch: (next: Partial<CallFilterState>) => void;
  onClear: () => void;
  active: boolean;
  showEmployee?: boolean;
  showRecording?: boolean;
}) {
  const me = useMe();
  const employees = useEmployeeList({});
  const outcomes = [...(me.data?.config.dispositions ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="call-filters">
      <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input value={state.q} onChange={(e) => patch({ q: e.target.value })} placeholder="Search name or number" className="pl-10 pr-9" aria-label="Search calls" data-testid="call-search" />
        {state.q ? (
          <button type="button" onClick={() => patch({ q: "" })} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3" aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showEmployee ? (
        <Select value={state.employee} onValueChange={(v) => patch({ employee: v })}>
          <SelectTrigger className="w-48" aria-label="Employee" data-testid="filter-employee">
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
      ) : null}

      <Select value={state.status} onValueChange={(v) => patch({ status: v })}>
        <SelectTrigger className="w-40" aria-label="Result" data-testid="filter-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={state.outcome} onValueChange={(v) => patch({ outcome: v })}>
        <SelectTrigger className="w-44" aria-label="Outcome" data-testid="filter-outcome">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any outcome</SelectItem>
          {outcomes.map((o) => (
            <SelectItem key={o.code} value={o.code}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={state.duration} onValueChange={(v) => patch({ duration: v })}>
        <SelectTrigger className="w-40" aria-label="Talk time" data-testid="filter-duration">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DURATION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showRecording ? (
        <Segmented
          name="call-recording"
          size="sm"
          value={state.recording}
          onChange={(v) => patch({ recording: v })}
          aria-label="Recording"
          options={[
            { value: "any", label: "Any" },
            { value: "yes", label: "Recorded" },
            { value: "no", label: "Not recorded" },
          ]}
        />
      ) : null}

      <Select value={state.sort} onValueChange={(v) => patch({ sort: v as CallFilterState["sort"] })}>
        <SelectTrigger className="w-40" aria-label="Order" data-testid="filter-sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">Newest first</SelectItem>
          <SelectItem value="oldest">Oldest first</SelectItem>
          <SelectItem value="longest">Longest talk first</SelectItem>
        </SelectContent>
      </Select>

      {active ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="size-4" /> Clear filters
        </Button>
      ) : null}
    </div>
  );
}
