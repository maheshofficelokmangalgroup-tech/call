"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarRange, Flag, Megaphone, Pencil, Plus, Send, Users } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api";
import { useCampaignAssignees, useCampaignMutations, useCampaignProgress, useCampaigns, useEmployeeList, useMe } from "@/lib/queries";
import { CAMPAIGN_STATUS, PRIORITY_LABEL, contactStatus } from "@/lib/status";
import type { Campaign } from "@/lib/types";
import { cn, formatDay, formatNumber, formatPercent, pluralize } from "@/lib/utils";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter a name (at least 2 letters).").max(150),
    description: z.string().trim().max(2000),
    status: z.enum(["draft", "active", "paused", "completed", "archived"]),
    priority: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    target_calls: z.string().refine((v) => v === "" || /^\d{1,9}$/.test(v), "Enter a whole number."),
  })
  .refine((v) => !v.start_date || !v.end_date || v.start_date <= v.end_date, { path: ["end_date"], message: "The end cannot be before the start." });
type Values = z.infer<typeof schema>;

function CampaignDialog({ open, onOpenChange, campaign }: { open: boolean; onOpenChange: (open: boolean) => void; campaign: Campaign | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <CampaignForm campaign={campaign} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it always starts from the campaign (or from empty fields). */
function CampaignForm({ campaign, onOpenChange }: { campaign: Campaign | null; onOpenChange: (open: boolean) => void }) {
  const { create, update } = useCampaignMutations();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: campaign?.name ?? "",
      description: campaign?.description ?? "",
      status: (campaign?.status as Values["status"]) ?? "draft",
      priority: String(campaign?.priority ?? 2),
      start_date: campaign?.start_date ?? "",
      end_date: campaign?.end_date ?? "",
      target_calls: campaign?.target_calls ? String(campaign.target_calls) : "",
    },
  });
  const [error, setError] = React.useState<string | null>(null);

  async function submit(v: Values) {
    setError(null);
    const body = {
      name: v.name,
      description: v.description || null,
      status: v.status,
      priority: Number(v.priority),
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      target_calls: v.target_calls ? Number(v.target_calls) : null,
    };
    try {
      if (campaign) await update.mutateAsync({ id: campaign.id, ...body });
      else await create.mutateAsync(body);
      toast.success(campaign ? "Campaign saved" : "Campaign created", { description: v.name });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <Megaphone className="size-6" />
            </div>
            <DialogTitle>{campaign ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>A campaign is a goal with a list of contacts, for example &ldquo;Diwali offer&rdquo; or &ldquo;Policy renewals&rdquo;.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="cm-name" required error={errors.name?.message}>
              <Input id="cm-name" autoFocus aria-invalid={!!errors.name} {...form.register("name")} data-testid="campaign-name" />
            </Field>
            <Field label="Description" htmlFor="cm-desc" error={errors.description?.message}>
              <Textarea id="cm-desc" rows={3} {...form.register("description")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="cm-status" hint="Only running campaigns show contacts to employees.">
                <Controller
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="cm-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CAMPAIGN_STATUS).map(([value, meta]) => (
                          <SelectItem key={value} value={value}>
                            {meta.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Priority" htmlFor="cm-priority">
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="cm-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3].map((p) => (
                          <SelectItem key={p} value={String(p)}>
                            {PRIORITY_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Starts" htmlFor="cm-start">
                <Input id="cm-start" type="date" {...form.register("start_date")} />
              </Field>
              <Field label="Ends" htmlFor="cm-end" error={errors.end_date?.message}>
                <Input id="cm-end" type="date" aria-invalid={!!errors.end_date} {...form.register("end_date")} />
              </Field>
              <Field label="Calls to make" htmlFor="cm-target" error={errors.target_calls?.message} hint="Optional goal for the whole campaign." className="sm:col-span-2">
                <Input id="cm-target" inputMode="numeric" className="max-w-48" aria-invalid={!!errors.target_calls} {...form.register("target_calls")} />
              </Field>
            </div>
            {error ? (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} data-testid="campaign-submit">
              {campaign ? "Save campaign" : "Create campaign"}
            </Button>
          </DialogFooter>
      </form>
    </>
  );
}

function CampaignDetails({ campaign, isAdmin, onEdit }: { campaign: Campaign; isAdmin: boolean; onEdit: () => void }) {
  const progress = useCampaignProgress(campaign.id);
  const assignees = useCampaignAssignees(isAdmin ? campaign.id : null);
  const employees = useEmployeeList({ isActive: true, role: "employee" });
  const { setAssignees, distribute } = useCampaignMutations();
  // the callers being chosen: null until the person changes something, so the saved list is shown until then
  const [draft, setDraft] = React.useState<number[] | null>(null);
  const picked = draft ?? assignees.data?.employee_ids ?? [];
  const dirty = draft !== null;
  const [strategy, setStrategy] = React.useState<"balanced" | "round_robin">("balanced");
  const status = CAMPAIGN_STATUS[campaign.status] ?? { label: campaign.status, tone: "neutral" as const };

  const data = progress.data;
  const byStatus = Object.entries(data?.contacts_by_status ?? {}).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...byStatus.map(([, n]) => n));
  const maxCalls = Math.max(1, ...(data?.calls_by_employee.map((e) => e.calls) ?? [1]));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface-2 px-6 pb-5 pt-6 pr-16">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Badge tone="outline">{PRIORITY_LABEL[campaign.priority]} priority</Badge>
        </div>
        <SheetTitle className="mt-3 text-2xl">{campaign.name}</SheetTitle>
        <SheetDescription className="mt-1">{campaign.description ?? "No description."}</SheetDescription>
        {isAdmin ? (
          <Button variant="secondary" size="sm" className="mt-4" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit campaign
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">Progress</h4>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Contacts", value: formatNumber(campaign.contact_count) },
              { label: "Finished", value: formatNumber(campaign.completed_count) },
              { label: "Calls made", value: `${formatNumber(campaign.calls_made)}${campaign.target_calls ? ` / ${formatNumber(campaign.target_calls)}` : ""}` },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl bg-surface-2 p-3.5 text-center">
                <p className="text-lg font-extrabold text-ink tnum">{s.value}</p>
                <p className="text-xs font-semibold text-muted">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs font-semibold text-muted">
              <span>Contacts finished</span>
              <span className="tnum">{formatPercent(campaign.completion_percent, 1)}</span>
            </div>
            <ProgressBar value={campaign.completion_percent} label="Campaign completion" />
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">Where the contacts stand</h4>
          {progress.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : byStatus.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">No contacts in this campaign yet. Add them from the Contacts page or an import.</p>
          ) : (
            <ul className="space-y-2.5">
              {byStatus.map(([key, n]) => (
                <li key={key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-semibold text-ink-soft">{contactStatus(key).label === key ? key.replace(/_/g, " ") : contactStatus(key).label}</span>
                    <span className="font-bold text-ink tnum">{formatNumber(n)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <motion.div className="h-full rounded-full bg-info" initial={{ width: 0 }} animate={{ width: `${(n / maxStatus) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">Calls by employee</h4>
          {progress.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.calls_by_employee.length ?? 0) === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">No calls have been made for this campaign yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {data?.calls_by_employee.map((e) => (
                <li key={e.employee_id} className="flex items-center gap-3">
                  <Avatar name={e.name} size="xs" />
                  <span className="w-32 truncate text-sm font-semibold text-ink-soft">{e.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(e.calls / maxCalls) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                  </div>
                  <span className="w-10 text-right text-sm font-bold text-ink tnum">{formatNumber(e.calls)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isAdmin ? (
          <section>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted">Who calls for this campaign</h4>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-line p-1.5">
              {employees.data?.items.map((e) => {
                const on = picked.includes(e.id);
                return (
                  <label key={e.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2", on ? "bg-brand-soft" : "hover:bg-surface-2")}>
                    <Checkbox checked={on} onCheckedChange={() => setDraft(on ? picked.filter((x) => x !== e.id) : [...picked, e.id])} aria-label={e.full_name} />
                    <Avatar name={e.full_name} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{e.full_name}</span>
                    <span className="text-xs text-muted">{e.team_name}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!dirty}
                loading={setAssignees.isPending}
                onClick={async () => {
                  try {
                    await setAssignees.mutateAsync({ id: campaign.id, employeeIds: picked });
                    setDraft(null);
                    toast.success("Callers saved");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Save callers
              </Button>
            </div>

            <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
              <p className="text-sm font-bold text-ink">Hand out the waiting contacts</p>
              <p className="mt-0.5 text-xs text-muted">Contacts of this campaign that nobody owns yet are shared between the callers above.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Segmented name="camp-strategy" size="sm" value={strategy} onChange={setStrategy} aria-label="How to share" options={[{ value: "balanced", label: "Evenly by workload" }, { value: "round_robin", label: "One by one" }]} />
                <Button
                  size="sm"
                  disabled={picked.length === 0 || dirty}
                  loading={distribute.isPending}
                  onClick={async () => {
                    try {
                      const r = await distribute.mutateAsync({ id: campaign.id, strategy });
                      toast.success(`${pluralize(r.assigned, "contact")} handed out`);
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                  data-testid="distribute"
                >
                  <Send className="size-3.5" /> Hand out
                </Button>
              </div>
              {dirty ? <p className="mt-2 text-xs text-warn">Save the callers first.</p> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function CampaignsView() {
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const campaigns = useCampaigns();
  const [filter, setFilter] = React.useState("all");
  const [dialog, setDialog] = React.useState(false);
  const [editing, setEditing] = React.useState<Campaign | null>(null);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [shownId, setShownId] = React.useState<number | null>(null);
  if (openId !== null && openId !== shownId) setShownId(openId);

  const list = React.useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: list.length };
    for (const x of list) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [list]);
  const visible = filter === "all" ? list : list.filter((c) => c.status === filter);
  const shown = list.find((c) => c.id === shownId) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="CRM"
        title="Campaigns"
        description="Goals with a list of contacts. Choose who calls for each campaign and watch the progress."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialog(true);
              }}
              data-testid="new-campaign"
            >
              <Plus className="size-4" /> New campaign
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[{ value: "all", label: "All" }, ...Object.entries(CAMPAIGN_STATUS).map(([value, m]) => ({ value, label: m.label }))].map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setFilter(o.value)}
            aria-pressed={filter === o.value}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all", filter === o.value ? "border-brand bg-brand-soft text-brand-strong shadow-card" : "border-line bg-surface text-ink-soft hover:bg-surface-2")}
          >
            {o.label}
            <span className={cn("rounded-full px-1.5 text-xs font-bold tnum", filter === o.value ? "bg-brand/15" : "bg-surface-3")}>{counts[o.value] ?? 0}</span>
          </button>
        ))}
      </div>

      {campaigns.isError ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The campaigns could not be loaded." onRetry={() => campaigns.refetch()} />
        </div>
      ) : campaigns.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <EmptyState icon={Megaphone} title={list.length === 0 ? "No campaigns yet" : "No campaigns in this group"} description={list.length === 0 ? "Create one, add contacts to it and choose who calls." : "Choose another status above."} action={isAdmin && list.length === 0 ? <Button onClick={() => setDialog(true)}><Plus className="size-4" /> New campaign</Button> : undefined} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="campaign-grid">
          {visible.map((c, i) => {
            const st = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
            return (
              <motion.button
                key={c.id}
                type="button"
                onClick={() => setOpenId(c.id)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="card-lift group rounded-2xl border border-line bg-surface p-5 text-left shadow-card"
                data-testid="campaign-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Megaphone className="size-5" />
                  </span>
                  <Badge tone={st.tone} dot>
                    {st.label}
                  </Badge>
                </div>
                <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink group-hover:text-brand">{c.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted">{c.description ?? "No description."}</p>
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs font-semibold text-muted">
                    <span>{formatNumber(c.completed_count)} of {formatNumber(c.contact_count)} contacts finished</span>
                    <span className="tnum">{formatPercent(c.completion_percent)}</span>
                  </div>
                  <ProgressBar value={c.completion_percent} label={`${c.name} progress`} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5" /> {formatNumber(c.calls_made)} calls{c.target_calls ? ` of ${formatNumber(c.target_calls)}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {c.start_date || c.end_date ? (
                      <>
                        <CalendarRange className="size-3.5" /> {c.start_date ? formatDay(c.start_date) : "..."} - {c.end_date ? formatDay(c.end_date) : "..."}
                      </>
                    ) : (
                      <>
                        <Flag className="size-3.5" /> {PRIORITY_LABEL[c.priority]}
                      </>
                    )}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent width="max-w-[560px]" aria-describedby={undefined} data-testid="campaign-drawer">
          {shown ? (
            <CampaignDetails
              key={shown.id}
              campaign={shown}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditing(shown);
                setDialog(true);
              }}
            />
          ) : (
            <SheetTitle className="sr-only">Campaign</SheetTitle>
          )}
        </SheetContent>
      </Sheet>

      {isAdmin ? <CampaignDialog open={dialog} onOpenChange={setDialog} campaign={editing} /> : null}
    </div>
  );
}
