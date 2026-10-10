"use client";

import { ArrowRightLeft, CheckCircle2, Loader2, Scale, ShieldAlert, Users } from "lucide-react";
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
import { useActivity, useLevel, useLevelPreview, useMe, useRebalance, useRebalancePreview, useRebalanceRun, useRebalanceRuns } from "@/lib/queries";
import { WORK_STATE, isWorking } from "@/lib/sharing";
import type { LevelPlan, LevelRequest, RebalancePlan, RebalanceRequest, RebalanceRun } from "@/lib/types";
import { cn, formatDate, formatNumber, pluralize, timeAgo } from "@/lib/utils";

type Filter = "all" | "working" | "away";

function Tile({ label, value, tone, hint, testId, className }: { label: string; value: React.ReactNode; tone: "brand" | "warn" | "neutral" | "info"; hint?: string; testId?: string; className?: string }) {
  const styles = { brand: "bg-brand-soft text-brand-strong", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-soft", info: "bg-info-soft text-info" }[tone];
  return (
    <div className={cn("rounded-2xl p-4", styles, className)} data-testid={testId}>
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
  const [levelOpen, setLevelOpen] = React.useState(false);

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
  const canLevel = !!data && data.working > 1;

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Work sharing"
        description={
          <>
            Who is working, and how the contacts are shared between them: the contacts of people who stopped working go to the ones who are working, and a new employee gets the same number as the others. An
            employee counts as working when they were seen in the last <b className="text-ink-soft">{data ? pluralize(data.inactive_after_days, "day") : "few days"}</b> (a new account counts from the
            moment it is made).
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/settings">Change the rule</Link>
            </Button>
            <Button variant="secondary" onClick={() => setLevelOpen(true)} disabled={!canLevel} data-testid="level-open">
              <Scale className="size-4" /> Give everybody the same
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="working" value={formatNumber(data.working)} tone="brand" testId="tile-working" />
            <Tile label="not working" value={formatNumber(data.not_working)} tone={data.not_working > 0 ? "warn" : "neutral"} testId="tile-away" />
            <Tile label="contacts waiting with them" value={formatNumber(data.movable)} tone={data.movable > 0 ? "warn" : "neutral"} hint="not called yet, no callback promised" testId="tile-movable" />
            <Tile label="automatic sharing" value={data.auto_rebalance ? "On" : "Off"} tone={data.auto_rebalance ? "info" : "neutral"} hint={data.auto_rebalance ? "checked every 10 minutes" : "you share them by hand"} testId="tile-auto" />
            <Tile
              label="same for everybody, by itself"
              value={data.auto_level ? "On" : "Off"}
              tone={data.auto_level ? "info" : "neutral"}
              hint={data.auto_level ? "a new employee within a minute or two" : "you share by hand"}
              testId="tile-auto-level"
              className="col-span-2 lg:col-span-1"
            />
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
              <p className="mt-0.5 text-xs text-muted">Every time contacts changed hands: taken from people who stopped working, or shared again so that everybody who is working has the same number.</p>
            </header>
            <RunsList />
          </section>
        </div>
      )}

      <RebalanceDialog open={open} onOpenChange={setOpen} />
      <LevelDialog open={levelOpen} onOpenChange={setLevelOpen} />
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
        <p className="mt-1 text-xs text-muted" data-testid="run-kind">
          {run.kind === "level" ? "Same number for everybody" : "From people who stopped"}
        </p>
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
          <RunResult run={r} testId="rebalance-run" />
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

/** How far one run is and, when it is finished, who received how many (for the equal sharing: also who gave). */
function RunResult({ run, testId, showGivers = false }: { run: RebalanceRun; testId: string; showGivers?: boolean }) {
  const finished = run.status !== "running";
  const to = (run.details?.to ?? []) as { employee_id?: number; name: string; received: number }[];
  const from = (run.details?.from ?? []) as { employee_id?: number; name: string; moved: number }[];
  return (
    <div className="rounded-2xl border border-line p-5" data-testid={testId}>
      <div className="flex items-center gap-3">
        {finished && run.status === "completed" ? <CheckCircle2 className="size-7 text-brand" /> : finished ? <ShieldAlert className="size-7 text-danger" /> : <Loader2 className="size-7 animate-spin text-brand" />}
        <p className="text-base font-bold text-ink tnum">
          {formatNumber(run.moved)} of {formatNumber(run.planned)} contacts moved
        </p>
      </div>
      {run.error_message ? <p className="mt-2 text-sm text-danger">{run.error_message}</p> : null}
      {finished && run.status === "completed" ? (
        <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm text-ink-soft">
          {to.map((t) => (
            <li key={`to-${t.employee_id ?? t.name}`} className="flex justify-between gap-3">
              <span>{t.name}</span>
              <span className="font-semibold tnum">+{formatNumber(t.received)}</span>
            </li>
          ))}
          {showGivers
            ? from.map((f) => (
                <li key={`from-${f.employee_id ?? f.name}`} className="flex justify-between gap-3">
                  <span>{f.name}</span>
                  <span className="font-semibold tnum text-warn">−{formatNumber(f.moved)}</span>
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </div>
  );
}

const EVERYBODY: LevelRequest = {};

function LevelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="level-dialog">
        <LevelBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open: it starts from the preview every time and shows the result of this run only. */
function LevelBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [runId, setRunId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const preview = useLevelPreview(EVERYBODY, runId === null);
  const level = useLevel();
  const run = useRebalanceRun(runId);
  const plan: LevelPlan | undefined = preview.data;

  async function go() {
    setError(null);
    try {
      const started = await level.mutateAsync(EVERYBODY);
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
          <Scale className="size-6" />
        </div>
        <DialogTitle>{runId === null ? "Give everybody the same number of contacts" : finished ? (r.status === "completed" ? "Done" : "It stopped half way") : "Sharing the contacts..."}</DialogTitle>
        <DialogDescription>
          {runId === null
            ? "The contacts nobody has called yet are shared out again, so that everybody who is working has the same number of them - also somebody who joined later. A promised callback, and every contact that was worked on, stays where it is."
            : "You can close this window; it carries on."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {runId === null ? (
          preview.isError ? (
            <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
              {errorMessage(preview.error)}
            </p>
          ) : preview.isPending || !plan ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <LevelSummary plan={plan} />
          )
        ) : r ? (
          <RunResult run={r} testId="level-run" showGivers />
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
            <Button onClick={go} disabled={!plan?.can_run} loading={level.isPending} data-testid="level-go">
              {plan?.can_run ? `Move ${pluralize(plan.total_move, "contact")}` : "Move"}
            </Button>
          </>
        ) : (
          <Button onClick={() => onOpenChange(false)}>{finished ? "Close" : "Close - it keeps going"}</Button>
        )}
      </DialogFooter>
    </>
  );
}

function LevelSummary({ plan }: { plan: LevelPlan }) {
  return (
    <div className="space-y-3">
      {plan.warnings.map((w) => (
        <p key={w} className="rounded-xl bg-warn-soft px-3.5 py-2 text-xs font-medium text-warn" data-testid="level-warning">
          {w}
        </p>
      ))}
      {plan.employees.length > 0 ? (
        <>
          <p className="text-sm text-ink-soft" data-testid="level-summary">
            <b className="text-ink tnum">{formatNumber(plan.total_waiting)}</b> contacts are waiting for a first call, with <b className="text-ink tnum">{formatNumber(plan.working)}</b> people who are working.
            {plan.total_move > 0 ? (
              <>
                {" "}
                <b className="text-ink tnum">{formatNumber(plan.total_move)}</b> of them change hands, so that everybody has the same number (one more for some, when it does not divide exactly).
              </>
            ) : null}
          </p>
          <TableWrap className="max-h-72 overflow-y-auto">
            <Table className="min-w-0">
              <THead className="sticky top-0 z-10">
                <TR>
                  <TH>Employee</TH>
                  <TH className="text-right">Waiting now</TH>
                  <TH className="text-right">After</TH>
                  <TH className="text-right">Change</TH>
                </TR>
              </THead>
              <tbody>
                {plan.employees.map((e) => (
                  <TR key={e.employee_id} data-testid="level-row">
                    <TD>
                      <span className="font-semibold text-ink">{e.full_name}</span> <span className="text-xs text-muted">{e.employee_code}</span>
                      <p className="text-xs text-muted tnum">{formatNumber(e.assigned)} contacts in all</p>
                    </TD>
                    <TD className="text-right tnum">{formatNumber(e.waiting)}</TD>
                    <TD className="text-right font-semibold text-ink tnum">{formatNumber(e.after)}</TD>
                    <TD className={cn("text-right font-bold tnum", e.gives > 0 ? "text-warn" : e.receives > 0 ? "text-brand-strong" : "text-muted")}>
                      {e.gives > 0 ? `−${formatNumber(e.gives)}` : e.receives > 0 ? `+${formatNumber(e.receives)}` : "-"}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      ) : null}
    </div>
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
