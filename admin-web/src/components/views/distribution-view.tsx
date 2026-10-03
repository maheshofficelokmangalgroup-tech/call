"use client";

import { ArrowRightLeft, CheckCircle2, Loader2, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useActivity, useMe, useRebalance, useRebalancePreview, useRebalanceRun, useRebalanceRuns } from "@/lib/queries";
import { WORK_STATE, isWorking } from "@/lib/sharing";
import type { RebalancePlan, RebalanceRequest, RebalanceRun } from "@/lib/types";
import { cn, formatDate, formatNumber, pluralize, timeAgo } from "@/lib/utils";

type Filter = "all" | "working" | "away";

function Tile({ label, value, tone, hint, testId }: { label: string; value: React.ReactNode; tone: "brand" | "warn" | "neutral" | "info"; hint?: string; testId?: string }) {
  const styles = { brand: "bg-brand-soft text-brand-strong", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-soft", info: "bg-info-soft text-info" }[tone];
  return (
    <div className={cn("rounded-2xl p-4", styles)} data-testid={testId}>
      <p className="text-2xl font-extrabold leading-none tnum">{value}</p>
      <p className="mt-1 text-xs font-semibold">{label}</p>
      {hint ? <p className="mt-1 text-[11px] opacity-80">{hint}</p> : null}
    </div>
  );
}

export function DistributionView() {
  const me = useMe();
  const activity = useActivity();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [open, setOpen] = React.useState(false);

  if (me.data && me.data.employee.role !== "admin") {
    return (
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <EmptyState icon={ShieldAlert} title="Only administrators can share work" description="Ask an administrator to look at who is working and where the contacts are." />
      </div>
    );
  }

  const data = activity.data;
  const list = (data?.employees ?? []).filter((e) => (filter === "all" ? true : filter === "working" ? isWorking(e.state) : !isWorking(e.state)));
  const canRebalance = !!data && data.movable > 0 && data.working > 0;

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Work sharing"
        description={
          <>
            Who is working, and where the contacts of people who stopped working go. An employee counts as working when they were seen in the last{" "}
            <b className="text-ink-soft">{data ? pluralize(data.inactive_after_days, "day") : "few days"}</b>.
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/settings">Change the rule</Link>
            </Button>
            <Button onClick={() => setOpen(true)} disabled={!canRebalance} data-testid="rebalance-open">
              <ArrowRightLeft className="size-4" /> Share their contacts now
            </Button>
          </>
        }
      />

      {activity.isError ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="Could not load who is working." onRetry={() => activity.refetch()} />
        </div>
      ) : !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="working" value={formatNumber(data.working)} tone="brand" testId="tile-working" />
            <Tile label="not working" value={formatNumber(data.not_working)} tone={data.not_working > 0 ? "warn" : "neutral"} testId="tile-away" />
            <Tile label="contacts waiting with them" value={formatNumber(data.movable)} tone={data.movable > 0 ? "warn" : "neutral"} hint="not called yet, no callback promised" testId="tile-movable" />
            <Tile label="automatic sharing" value={data.auto_rebalance ? "On" : "Off"} tone={data.auto_rebalance ? "info" : "neutral"} hint={data.auto_rebalance ? "checked every 10 minutes" : "you share them by hand"} testId="tile-auto" />
          </div>

          <section className="rounded-2xl border border-line bg-surface shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <h2 className="text-base font-extrabold text-ink">Employees</h2>
              <Segmented
                name="dist-filter"
                size="sm"
                value={filter}
                onChange={setFilter}
                aria-label="Show"
                options={[
                  { value: "all", label: "All", count: data.employees.length },
                  { value: "working", label: "Working", count: data.working },
                  { value: "away", label: "Not working", count: data.not_working },
                ]}
              />
            </header>
            <TableWrap className="max-h-[28rem] overflow-y-auto border-0 shadow-none">
              <Table className="min-w-[720px]">
                <THead className="sticky top-0 z-10">
                  <TR>
                    <TH>Employee</TH>
                    <TH>State</TH>
                    <TH>Last seen</TH>
                    <TH className="text-right">Contacts now</TH>
                    <TH className="text-right">Can be taken back</TH>
                  </TR>
                </THead>
                <tbody>
                  {list.map((e) => {
                    const meta = WORK_STATE[e.state];
                    return (
                      <TR key={e.employee_id} data-testid="work-row">
                        <TD>
                          <Link href={`/employees/${e.employee_id}`} className="font-semibold text-ink hover:underline">
                            {e.full_name}
                          </Link>{" "}
                          <span className="text-xs text-muted">
                            {e.employee_code}
                            {e.team_name ? ` · ${e.team_name}` : ""}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={meta.tone} title={meta.hint}>
                            {meta.label}
                          </Badge>
                          {e.reason ? <span className="ml-2 text-xs text-muted">{e.reason}</span> : null}
                        </TD>
                        <TD className="text-sm text-ink-soft">{e.last_active_at ? timeAgo(e.last_active_at) : "never"}</TD>
                        <TD className="text-right tnum">{formatNumber(e.assigned)}</TD>
                        <TD className={cn("text-right tnum", e.movable > 0 ? "font-bold text-warn" : "text-muted")}>{e.movable > 0 ? formatNumber(e.movable) : "-"}</TD>
                      </TR>
                    );
                  })}
                  {list.length === 0 ? (
                    <TR>
                      <TD colSpan={5} className="py-10 text-center text-muted">
                        Nobody here.
                      </TD>
                    </TR>
                  ) : null}
                </tbody>
              </Table>
            </TableWrap>
          </section>

          <section className="rounded-2xl border border-line bg-surface shadow-card">
            <header className="border-b border-line px-5 py-4">
              <h2 className="text-base font-extrabold text-ink">What was shared</h2>
              <p className="mt-0.5 text-xs text-muted">Every time contacts were taken from people who stopped working and given to people who are working.</p>
            </header>
            <RunsList />
          </section>
        </div>
      )}

      <RebalanceDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function RunsList() {
  const [page, setPage] = React.useState(1);
  const runs = useRebalanceRuns(page);
  if (runs.isPending) return <Skeleton className="m-5 h-24" />;
  if (!runs.data || runs.data.items.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">Nothing has been shared yet.</p>;
  return (
    <div>
      <TableWrap className="border-0 shadow-none">
        <Table className="min-w-[640px]">
          <THead>
            <TR>
              <TH>When</TH>
              <TH>By</TH>
              <TH>Result</TH>
              <TH>From → to</TH>
            </TR>
          </THead>
          <tbody>
            {runs.data.items.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination page={page} pageSize={10} total={runs.data.total} onPage={setPage} />
    </div>
  );
}

function RunRow({ run }: { run: RebalanceRun }) {
  const from = ((run.details?.from ?? []) as { name: string; moved: number }[]).slice(0, 3);
  const to = (run.details?.to ?? []) as { name: string; received: number }[];
  return (
    <TR data-testid="run-row">
      <TD className="whitespace-nowrap text-sm">{formatDate(run.created_at)}</TD>
      <TD>
        <Badge tone={run.trigger === "auto" ? "info" : "neutral"}>{run.trigger === "auto" ? "Automatic" : "By hand"}</Badge>
      </TD>
      <TD>
        {run.status === "completed" ? (
          <span className="font-semibold text-ink tnum">{pluralize(run.moved, "contact")} moved</span>
        ) : run.status === "running" ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
            <Loader2 className="size-3.5 animate-spin" /> {formatNumber(run.moved)} of {formatNumber(run.planned)}
          </span>
        ) : (
          <span className="text-sm text-danger" title={run.error_message ?? undefined}>
            Stopped after {formatNumber(run.moved)} of {formatNumber(run.planned)}
          </span>
        )}
      </TD>
      <TD className="text-xs text-muted">
        {from.map((f) => `${f.name} (${formatNumber(f.moved)})`).join(", ")}
        {from.length > 0 ? ` → ${pluralize(to.length, "employee")}` : ""}
      </TD>
    </TR>
  );
}

function RebalanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="rebalance-dialog">
        <RebalanceBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open: it starts from the preview every time and shows the result of this run only. */
function RebalanceBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [strategy, setStrategy] = React.useState<RebalanceRequest["strategy"]>("equal");
  const [order, setOrder] = React.useState<RebalanceRequest["order"]>("interleave");
  const [runId, setRunId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const request: RebalanceRequest = { strategy, order };
  const preview = useRebalancePreview(request, runId === null);
  const rebalance = useRebalance();
  const run = useRebalanceRun(runId);
  const plan: RebalancePlan | undefined = preview.data;

  async function go() {
    setError(null);
    try {
      const started = await rebalance.mutateAsync(request);
      setRunId(started.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const r = run.data;
  const finished = r && r.status !== "running";
  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <ArrowRightLeft className="size-6" />
        </div>
        <DialogTitle>{runId === null ? "Share the contacts of people who stopped" : finished ? (r.status === "completed" ? "Done" : "It stopped half way") : "Moving the contacts..."}</DialogTitle>
        <DialogDescription>
          {runId === null
            ? "Contacts nobody has called yet are taken from employees who are not working and given to the ones who are. A promised callback, and every contact that was worked on, stays where it is."
            : "You can close this window; it carries on."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {runId === null ? (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <Segmented
                name="rb-strategy"
                size="sm"
                value={strategy}
                onChange={setStrategy}
                aria-label="How many each"
                options={[
                  { value: "equal", label: "The same for everybody" },
                  { value: "balance_total", label: "Even out the work" },
                ]}
              />
              <Segmented
                name="rb-order"
                size="sm"
                value={order}
                onChange={setOrder}
                aria-label="Order"
                options={[
                  { value: "interleave", label: "Mixed" },
                  { value: "blocks", label: "In blocks" },
                ]}
              />
            </div>
            {preview.isPending || !plan ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <PlanSummary plan={plan} />
            )}
          </>
        ) : r ? (
          <div className="rounded-2xl border border-line p-5" data-testid="rebalance-run">
            <div className="flex items-center gap-3">
              {finished && r.status === "completed" ? <CheckCircle2 className="size-7 text-brand" /> : finished ? <ShieldAlert className="size-7 text-danger" /> : <Loader2 className="size-7 animate-spin text-brand" />}
              <p className="text-base font-bold text-ink tnum">
                {formatNumber(r.moved)} of {formatNumber(r.planned)} contacts moved
              </p>
            </div>
            {r.error_message ? <p className="mt-2 text-sm text-danger">{r.error_message}</p> : null}
            {finished && r.status === "completed" ? (
              <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                {((r.details?.to ?? []) as { name: string; received: number }[]).map((t) => (
                  <li key={t.name} className="flex justify-between gap-3">
                    <span>{t.name}</span>
                    <span className="font-semibold tnum">+{formatNumber(t.received)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {runId === null ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={go} disabled={!plan?.can_run} loading={rebalance.isPending} data-testid="rebalance-go">
              {plan ? `Move ${pluralize(plan.total_movable, "contact")}` : "Move"}
            </Button>
          </>
        ) : (
          <Button onClick={() => onOpenChange(false)}>{finished ? "Close" : "Close - it keeps going"}</Button>
        )}
      </DialogFooter>
    </>
  );
}

function PlanSummary({ plan }: { plan: RebalancePlan }) {
  return (
    <div className="space-y-3">
      {plan.warnings.map((w) => (
        <p key={w} className="rounded-xl bg-warn-soft px-3.5 py-2 text-xs font-medium text-warn">
          {w}
        </p>
      ))}
      {plan.sources.length === 0 ? (
        <p className="rounded-2xl border border-line p-5 text-sm text-muted">Nobody who is not working has contacts that can be moved.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
              <Users className="size-4" /> Taken from
            </p>
            <TableWrap className="max-h-56 overflow-y-auto">
              <Table>
                <tbody>
                  {plan.sources.map((s) => (
                    <TR key={s.employee_id}>
                      <TD>
                        <span className="font-semibold text-ink">{s.full_name}</span>
                        <p className="text-xs text-muted">{s.reason}</p>
                      </TD>
                      <TD className="text-right">
                        <span className="font-bold tnum text-warn">−{formatNumber(s.movable)}</span>
                        {s.kept > 0 ? <p className="text-xs text-muted tnum">{formatNumber(s.kept)} stay</p> : null}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
              <Users className="size-4" /> Given to ({plan.working} working)
            </p>
            <TableWrap className="max-h-56 overflow-y-auto">
              <Table>
                <tbody>
                  {plan.targets.map((t) => (
                    <TR key={t.employee_id}>
                      <TD>
                        <span className="font-semibold text-ink">{t.full_name}</span>
                        <p className="text-xs text-muted tnum">has {formatNumber(t.assigned)} now</p>
                      </TD>
                      <TD className="text-right font-bold tnum text-brand-strong">+{formatNumber(t.receives)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </div>
      )}
    </div>
  );
}
