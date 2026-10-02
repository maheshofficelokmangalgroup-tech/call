"use client";

import { Download, FileUp, Phone, Search, Target, UserPlus, Users, X } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { BulkImportDialog } from "@/components/domain/bulk-import-dialog";
import { EmployeeActions } from "@/components/domain/employee-actions";
import { EmployeeCell } from "@/components/domain/employee-cell";
import { EmployeeFormDialog } from "@/components/domain/employee-form-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { DeviceFlag } from "@/components/domain/device-health";
import { PRESENCE_META, PresenceLabel } from "@/components/ui/presence";
import { ProgressBar } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SortHead, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadUrl } from "@/lib/api";
import { useDebounced, usePageReset } from "@/lib/hooks";
import { useUrlParam } from "@/lib/use-url-param";
import { useEmployeeStats, useMe, useTeams } from "@/lib/queries";
import { useRange } from "@/lib/range";
import { PRESENCE_ORDER } from "@/lib/status";
import type { EmployeeMetrics, Presence } from "@/lib/types";
import { cn, formatDuration, formatNumber, formatPercent, timeAgo } from "@/lib/utils";

const PAGE_SIZE = 25;
type SortKey = "name" | "calls" | "answer_rate" | "talk" | "avg_talk" | "contacts" | "recordings" | "last_seen";

function StatusCell({ person }: { person: EmployeeMetrics }) {
  return (
    <div className="leading-tight">
      <div className="flex items-center gap-1.5">
        <PresenceLabel presence={person.presence} className="text-[13px]" />
        <DeviceFlag status={person.device_status} />
      </div>
      <p className="mt-0.5 whitespace-nowrap pl-[18px] text-xs text-muted">
        {person.presence === "inactive" ? "cannot sign in" : person.presence === "on_call" ? "talking now" : person.last_seen_at ? timeAgo(person.last_seen_at) : "never signed in"}
      </p>
    </div>
  );
}

function TodayCell({ person }: { person: EmployeeMetrics }) {
  if (person.daily_target === 0) return <span className="text-sm text-muted tnum">{formatNumber(person.today_calls)} calls</span>;
  const done = person.today_target_percent >= 100;
  return (
    <div className="w-28">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-bold text-ink tnum">{formatNumber(person.today_calls)}</span>
        <span className="text-muted tnum">of {formatNumber(person.daily_target)}</span>
      </div>
      <ProgressBar value={person.today_target_percent} tone={done ? "brand" : person.today_target_percent >= 50 ? "info" : "warn"} label={`${person.full_name} today`} />
    </div>
  );
}

function PersonCard({ person, onOpen }: { person: EmployeeMetrics; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-colors active:bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <EmployeeCell name={person.full_name} subtitle={`${person.employee_code} · ${person.team_name ?? "No team"}`} presence={person.presence} linked={false} size="md" />
        <span className={cn("shrink-0 text-xs font-bold", PRESENCE_META[person.presence].text)}>{PRESENCE_META[person.presence].label}</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Calls", value: formatNumber(person.calls) },
          { label: "Answered", value: formatPercent(person.answer_rate) },
          { label: "Talk time", value: formatDuration(person.talk_seconds, { compact: true }) },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-surface-2 py-2">
            <dd className="text-base font-extrabold text-ink tnum">{item.value}</dd>
            <dt className="text-[11px] font-semibold text-muted">{item.label}</dt>
          </div>
        ))}
      </dl>
      {person.daily_target > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Today</span>
            <span className="tnum">
              {person.today_calls} / {person.daily_target}
            </span>
          </div>
          <ProgressBar value={person.today_target_percent} />
        </div>
      ) : null}
    </button>
  );
}

export function EmployeesView() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const { range, label } = useRange();
  const teams = useTeams();

  const [search, setSearch] = React.useState("");
  const q = useDebounced(search, 300);
  const teamParam = params.get("team");
  const [team, setTeam] = React.useState(teamParam && /^\d+$/.test(teamParam) ? teamParam : "all");
  const [role, setRole] = React.useState("all");
  const [state, setState] = React.useState<"all" | "active" | "inactive">("all");
  const [presence, setPresence] = React.useState<"all" | Presence>("all");
  const [sort, setSort] = React.useState<SortKey>("calls");
  const [order, setOrder] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = usePageReset([q, team, role, state, presence, sort, order, range.from, range.to]);
  // "New employee" lives in the address (?new=1), so the command palette can open it and the back button closes it
  const [newParam, setNewParam] = useUrlParam("new");
  const createOpen = newParam === "1";
  const setCreateOpen = (open: boolean) => setNewParam(open ? "1" : null);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const teamId = team === "all" ? null : Number(team);
  const stats = useEmployeeStats(range, { q: q || undefined, teamId, role: role === "all" ? undefined : role, state, sort, order });
  const all = React.useMemo(() => stats.data?.items ?? [], [stats.data]);
  const counts = React.useMemo(() => {
    const c: Record<Presence, number> = { on_call: 0, online: 0, idle: 0, offline: 0, inactive: 0 };
    for (const p of all) c[p.presence] += 1;
    return c;
  }, [all]);
  const visible = React.useMemo(() => (presence === "all" ? all : all.filter((p) => p.presence === presence)), [all, presence]);
  const pageRows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (key === sort) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder(key === "name" ? "asc" : "desc");
    }
  };
  const filtered = !!(q || team !== "all" || role !== "all" || state !== "all" || presence !== "all");
  const clear = () => {
    setSearch("");
    setTeam("all");
    setRole("all");
    setState("all");
    setPresence("all");
  };
  const open = (id: number) => router.push(`/employees/${id}`);

  const exportHref = downloadUrl("analytics/employees.csv", { date_from: range.from, date_to: range.to, q: q || undefined, team_id: teamId, role: role === "all" ? undefined : role, state });
  const loading = stats.isPending;

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Employees"
        description={
          <>
            How much everyone called <span className="font-semibold text-ink-soft">{label.toLowerCase()}</span>, for how long, and who is working right now.
          </>
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={exportHref} download data-testid="export-employees">
                <Download className="size-4" /> Export
              </a>
            </Button>
            {isAdmin ? (
              <>
                <Button variant="secondary" onClick={() => setBulkOpen(true)} data-testid="bulk-open">
                  <FileUp className="size-4" /> Import sheet
                </Button>
                <Button onClick={() => setCreateOpen(true)} data-testid="new-employee">
                  <UserPlus className="size-4" /> New employee
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {/* who is doing what right now */}
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by activity">
        {(["all", ...PRESENCE_ORDER] as const).map((key) => {
          const active = presence === key;
          const total = key === "all" ? all.length : counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPresence(key)}
              aria-pressed={active}
              data-testid={`chip-${key}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all",
                active ? "border-brand bg-brand-soft text-brand-strong shadow-card" : "border-line bg-surface text-ink-soft hover:border-line-strong hover:bg-surface-2",
              )}
            >
              {key !== "all" ? <span className={cn("size-2 rounded-full", PRESENCE_META[key].dot)} /> : <Users className="size-3.5" />}
              {key === "all" ? "Everyone" : PRESENCE_META[key].label}
              <span className={cn("rounded-full px-1.5 text-xs font-bold tnum", active ? "bg-brand/15" : "bg-surface-3")}>{total}</span>
            </button>
          );
        })}
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID or email" className="pl-10 pr-9" aria-label="Search employees" data-testid="employee-search" />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3" aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Select value={team} onValueChange={setTeam}>
          <SelectTrigger className="w-44" aria-label="Team">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.data?.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-40" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="employee">Employees</SelectItem>
            <SelectItem value="manager">Managers</SelectItem>
            <SelectItem value="admin">Administrators</SelectItem>
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
          <SelectTrigger className="w-40" aria-label="Account state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any account</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Deactivated</SelectItem>
          </SelectContent>
        </Select>
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="size-4" /> Clear filters
          </Button>
        ) : null}
      </div>

      {stats.isError && !stats.data ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The employee list could not be loaded." onRetry={() => stats.refetch()} />
        </div>
      ) : (
        <>
          {/* phones */}
          <div className="grid gap-3 md:hidden">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)
              : pageRows.map((p) => <PersonCard key={p.id} person={p} onOpen={() => open(p.id)} />)}
          </div>

          {/* desktop */}
          <TableWrap className={cn("hidden md:block", stats.isFetching && !loading && "opacity-80 transition-opacity")}>
            <Table className="min-w-[940px]" data-testid="employee-table">
              <THead>
                <TR>
                  <SortHead label="Employee" active={sort === "name"} direction={order} onSort={() => toggleSort("name")} />
                  <SortHead label="Status" active={sort === "last_seen"} direction={order} onSort={() => toggleSort("last_seen")} />
                  <SortHead label="Calls" active={sort === "calls"} direction={order} onSort={() => toggleSort("calls")} align="right" />
                  <SortHead label="Answer rate" active={sort === "answer_rate"} direction={order} onSort={() => toggleSort("answer_rate")} align="right" />
                  <SortHead label="Talk time" active={sort === "talk"} direction={order} onSort={() => toggleSort("talk")} align="right" />
                  <SortHead label="People" active={sort === "contacts"} direction={order} onSort={() => toggleSort("contacts")} align="right" />
                  <SortHead label="Recordings" active={sort === "recordings"} direction={order} onSort={() => toggleSort("recordings")} align="right" />
                  <TH>Today</TH>
                  <TH className="w-12" aria-label="Actions" />
                </TR>
              </THead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TR key={i}>
                        <TD colSpan={9}>
                          <Skeleton className="h-10 w-full" />
                        </TD>
                      </TR>
                    ))
                  : pageRows.map((p, i) => (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.3 }}
                        onClick={() => open(p.id)}
                        onKeyDown={(e) => e.key === "Enter" && open(p.id)}
                        tabIndex={0}
                        data-testid="employee-row"
                        className="cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2 focus-visible:bg-surface-2"
                      >
                        <TD>
                          <EmployeeCell name={p.full_name} subtitle={`${p.employee_code} · ${p.team_name ?? "No team"}${p.role !== "employee" ? ` · ${p.role}` : ""}`} presence={p.presence} linked={false} />
                        </TD>
                        <TD>
                          <StatusCell person={p} />
                        </TD>
                        <TD className="text-right">
                          <p className="text-base font-extrabold leading-tight text-ink tnum">{formatNumber(p.calls)}</p>
                          <p className="whitespace-nowrap text-xs text-muted tnum">{formatNumber(p.connected)} picked up</p>
                        </TD>
                        <TD className="text-right">
                          <p className="font-semibold leading-tight text-ink tnum">{p.calls ? formatPercent(p.answer_rate) : "-"}</p>
                          <div className="ml-auto mt-1.5 h-1 w-14 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, p.answer_rate)}%` }} />
                          </div>
                        </TD>
                        <TD className="text-right">
                          <p className="whitespace-nowrap font-semibold leading-tight text-ink tnum">{p.calls ? formatDuration(p.talk_seconds, { compact: true }) : "-"}</p>
                          <p className="whitespace-nowrap text-xs text-muted tnum">{p.connected ? `avg ${formatDuration(p.avg_talk_seconds, { compact: true })}` : ""}</p>
                        </TD>
                        <TD className="text-right text-ink-soft tnum">{formatNumber(p.unique_contacts)}</TD>
                        <TD className="text-right text-ink-soft tnum">{formatNumber(p.recordings)}</TD>
                        <TD>
                          <TodayCell person={p} />
                        </TD>
                        <TD className="text-right">
                          <EmployeeActions employee={p} />
                        </TD>
                      </motion.tr>
                    ))}
              </tbody>
            </Table>
          </TableWrap>

          {!loading && visible.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
              {filtered ? (
                <EmptyState icon={Search} title="Nobody matches these filters" description="Try a different search, or clear the filters to see everyone." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
              ) : (
                <EmptyState
                  icon={Phone}
                  title="No employees yet"
                  description="Create the first login. The employee signs in on the mobile app and every call shows up here."
                  action={isAdmin ? <Button onClick={() => setCreateOpen(true)}><UserPlus className="size-4" /> New employee</Button> : undefined}
                />
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={visible.length} onPage={setPage} />
          </div>
          {!loading && visible.length > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted">
              <Target className="size-3.5" /> &ldquo;Today&rdquo; counts calls made since midnight against each person&apos;s daily target. All other figures are for {label.toLowerCase()}.
            </p>
          ) : null}
        </>
      )}

      {isAdmin ? (
        <>
          <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} selfId={me.data?.employee.id} />
          <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} />
        </>
      ) : null}
    </div>
  );
}
