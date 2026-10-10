"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, OctagonX, UploadCloud, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { ProgressBar } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadUrl, errorMessage } from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { useCampaigns, useEmployeeList, useImport, useImportMutations, useImportPlan, useImportRows, useSettings, type PlanParams } from "@/lib/queries";
import { WORK_STATE, eachText, formatEta, rowsPerSecond } from "@/lib/sharing";
import { PRIORITY_LABEL } from "@/lib/status";
import type { ImportJob, ImportPlan } from "@/lib/types";
import { cn, downloadText, formatNumber, pluralize } from "@/lib/utils";

const MAX_MB = 200;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const SAMPLE = ["name,phone,email,city,category,tags,priority,Company", 'Rahul Sharma,9822012345,rahul@example.com,Pune,Retail,"vip, repeat",high,Sahyadri Traders', "Sneha Patil,+91 98765 43210,,Nashik,Wholesale,,normal,Omkar Enterprises"].join("\r\n");

type Step = "setup" | "uploading" | "checking" | "preview" | "applying" | "done" | "stopped" | "failed";
type RowFilter = "all" | "valid" | "invalid" | "duplicate";
type ShareMode = "working" | "chosen" | "none";

function Stat({ label, value, tone }: { label: string; value: number; tone: "brand" | "danger" | "warn" | "neutral" }) {
  const styles = { brand: "bg-brand-soft text-brand-strong", danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-soft" }[tone];
  return (
    <div className={cn("rounded-2xl p-4", styles)}>
      <p className="text-2xl font-extrabold leading-none tnum">{formatNumber(value)}</p>
      <p className="mt-1 text-xs font-semibold">{label}</p>
    </div>
  );
}

/** Upload a contact sheet, check it, see who would get what, and only then add it. A sheet of a million rows is fine. */
export function ImportWizard({ open, onOpenChange, resumeId = null }: { open: boolean; onOpenChange: (open: boolean) => void; resumeId?: number | null }) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent size="xl" data-testid="import-dialog" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} hideClose>
        <ImportBody onOpenChange={onOpenChange} resumeId={resumeId} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted only while the wizard is open, so every opening starts at the first step. Where the person is in the process
 * follows the status the server reports for the import, not a copy of it kept here - so an import that is already running
 * (opened again from the banner on the contacts page) shows its progress exactly like one that was just started.
 */
function ImportBody({ onOpenChange, resumeId }: { onOpenChange: (open: boolean) => void; resumeId: number | null }) {
  const settings = useSettings();
  const campaigns = useCampaigns();
  const { upload, confirm, retry, cancel } = useImportMutations();

  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [sent, setSent] = React.useState<{ sent: number; total: number } | null>(null);
  const [modeChoice, setModeChoice] = React.useState<"skip" | "update" | null>(null);
  const [campaign, setCampaign] = React.useState("none");
  const [priority, setPriority] = React.useState("2");
  const [groupPeople, setGroupPeople] = React.useState(false);
  const [importId, setImportId] = React.useState<number | null>(resumeId);
  const [shareChoice, setShareChoice] = React.useState<ShareMode | null>(null);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [strategy, setStrategy] = React.useState<PlanParams["strategy"]>("equal");
  const [order, setOrder] = React.useState<PlanParams["order"]>("interleave");
  const [tab, setTab] = React.useState<"sharing" | "rows">("sharing");
  const [rowChoice, setRowChoice] = React.useState<RowFilter | null>(null);
  const [rowPage, setRowPage] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [stopAsked, setStopAsked] = React.useState(false);

  const job = useImport(importId);
  const j = job.data;
  const status = j?.status;
  const step: Step =
    upload.isPending && importId === null
      ? "uploading"
      : importId === null
        ? "setup"
        : !status || status === "validating"
          ? "checking"
          : status === "previewed"
            ? "preview"
            : status === "applying"
              ? "applying"
              : status === "completed"
                ? "done"
                : status === "cancelled" && j?.confirmed_at
                  ? "stopped"
                  : "failed";

  const mode = modeChoice ?? settings.data?.duplicate_policy ?? "skip";
  const rowFilter: RowFilter = rowChoice ?? (j && j.invalid_rows > 0 ? "invalid" : j && j.duplicate_rows > 0 ? "duplicate" : "all");
  const rows = useImportRows(step === "preview" && tab === "rows" ? importId : null, rowFilter === "all" ? undefined : rowFilter, rowPage);

  // Who gets the new contacts. Until the administrator chooses, everybody who is working does - or nobody, when nobody is.
  const probe = useImportPlan(step === "preview" ? importId : null, { employeeIds: [], strategy, order, leaveUnassigned: false });
  const nobodyWorking = shareChoice === null && !!probe.data && probe.data.to_distribute > 0 && probe.data.working === 0;
  const share: ShareMode = shareChoice ?? (nobodyWorking ? "none" : "working");
  const planParams: PlanParams = { employeeIds: share === "chosen" ? picked : [], strategy, order, leaveUnassigned: share === "none" };
  const planQuery = useImportPlan(step === "preview" ? importId : null, planParams);
  const plan = planQuery.data;

  const now = useNow(1000);

  function choose(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!/\.(csv|xlsx|txt)$/i.test(f.name)) {
      setFileError("Choose a .csv or .xlsx file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(`That file is larger than ${MAX_MB} MB. Split it into two sheets.`);
      return;
    }
    setFile(f);
  }

  async function start() {
    if (!file) return;
    setError(null);
    setSent({ sent: 0, total: file.size });
    try {
      const created = await upload.mutateAsync({ file, mode, campaignId: campaign === "none" ? null : Number(campaign), priority: Number(priority), groupPeople, onProgress: (done, total) => setSent({ sent: done, total }) });
      setImportId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function pick(next: ShareMode) {
    setShareChoice(next);
    if (next === "chosen" && picked.length === 0 && plan) setPicked(plan.employees.filter((e) => e.receives).map((e) => e.employee_id));
  }

  async function apply() {
    if (importId === null) return;
    setError(null);
    try {
      await confirm.mutateAsync({ id: importId, mode, plan: planParams });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function carryOn() {
    if (importId === null) return;
    setError(null);
    try {
      await retry.mutateAsync(importId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function stop() {
    if (importId === null) return;
    setStopAsked(false);
    try {
      await cancel.mutateAsync(importId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function leave() {
    if (importId !== null && (step === "preview" || step === "checking")) {
      try {
        await cancel.mutateAsync(importId);
      } catch {
        /* nothing to undo */
      }
    }
    onOpenChange(false);
  }

  const busy = upload.isPending || confirm.isPending || retry.isPending;
  const title =
    step === "done"
      ? "Import finished"
      : step === "stopped"
        ? "Import stopped"
        : step === "preview"
          ? "Check the sheet"
          : step === "failed"
            ? "The import could not finish"
            : step === "applying"
              ? "Adding contacts..."
              : step === "checking"
                ? "Checking your sheet..."
                : step === "uploading"
                  ? "Sending your sheet..."
                  : "Import contacts from a sheet";
  const toAdd = j ? j.valid_rows + (mode === "update" ? j.existing_rows : 0) : 0;
  const cannotShare = plan ? !plan.can_confirm : false;
  const nobodyChosen = share === "chosen" && picked.length === 0;

  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <FileSpreadsheet className="size-6" />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {step === "setup"
            ? `Upload an Excel or CSV file with a header row - up to ${MAX_MB} MB, about a million contacts. Nothing is added until you have seen the check.`
            : step === "preview"
              ? "Review what will happen. You can still cancel."
              : step === "done"
                ? "The contacts are in the system."
                : step === "applying"
                  ? "You can close this window; the contacts keep being added. Open the import again from the Contacts page to see how far it is."
                  : "This can take a few minutes for a big sheet."}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <AnimatePresence mode="wait" initial={false}>
          {step === "setup" ? (
            <motion.div key="setup" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  choose(e.dataTransfer.files[0]);
                }}
                className={cn("flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-brand bg-brand-soft" : file ? "border-brand/50 bg-brand-soft/40" : "border-line-strong bg-surface-2 hover:border-brand/60")}
              >
                <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} data-testid="import-file" />
                <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface text-brand shadow-pop">{file ? <FileSpreadsheet className="size-6" /> : <UploadCloud className="size-6" />}</span>
                <span className="text-base font-bold text-ink">{file ? file.name : "Drop your sheet here"}</span>
                <span className="mt-1 text-sm text-muted">{file ? `${file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`} · click to choose another` : `.csv or .xlsx, up to ${MAX_MB} MB`}</span>
              </label>
              {fileError ? (
                <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
                  {fileError}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-ink-soft">If a phone number already exists</p>
                  <Segmented
                    name="imp-mode"
                    size="sm"
                    value={mode}
                    onChange={setModeChoice}
                    aria-label="Duplicates"
                    options={[
                      { value: "skip", label: "Skip it" },
                      { value: "update", label: "Update it" },
                    ]}
                  />
                  <p className="text-xs text-muted">A number is never added twice, either way.</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-ink-soft">Priority when the sheet has none</p>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger aria-label="Default priority">
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
                </div>
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-ink-soft">Add them to a campaign</p>
                  <Select value={campaign} onValueChange={setCampaign}>
                    <SelectTrigger aria-label="Campaign">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No campaign</SelectItem>
                      {campaigns.data?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4 text-sm">
                <p className="text-muted">
                  The sheet needs a <b className="text-ink">name</b> and a <b className="text-ink">phone</b> column; email, city, category, tags, priority and any other column are optional.{" "}
                  <b className="text-ink">Every different phone number becomes a contact of its own</b>: only a number that is in the sheet twice, or that is a contact already, is added once - the name decides nothing, so two
                  people with the same name and different numbers are two contacts. After the check you choose who gets the contacts - by default <b className="text-ink">everybody who is working, the same number each</b>.
                </p>
                <Button variant="secondary" size="sm" onClick={() => downloadText("contacts-sample.csv", SAMPLE)}>
                  <Download className="size-4" /> Sample file
                </Button>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-4 text-sm" data-testid="import-group-people-row">
                <Checkbox checked={groupPeople} onCheckedChange={(on) => setGroupPeople(on === true)} className="mt-0.5" aria-label="Put the numbers of one person together" data-testid="import-group-people" />
                <span>
                  <span className="block font-bold text-ink">Put the numbers of one person together</span>
                  <span className="block text-xs text-muted">
                    Only for a list of people (<i>Mobile Number, Voter Name, Relative Name, Age, Gender, Voter Pincode, Voter Address</i>): the lines of the same person become one contact that lists all their numbers. Leave it off
                    for every other sheet. No number is lost either way.
                  </span>
                </span>
              </label>
            </motion.div>
          ) : step === "uploading" ? (
            <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3 py-10 text-center">
              <UploadCloud className="mx-auto size-10 text-brand" />
              <p className="text-base font-bold text-ink">Sending the sheet to the server...</p>
              <div className="mx-auto max-w-md">
                <ProgressBar value={sent && sent.total ? (sent.sent / sent.total) * 100 : 0} label="Upload" />
                <p className="mt-2 text-sm text-muted tnum">{sent ? `${(sent.sent / 1024 / 1024).toFixed(1)} of ${(sent.total / 1024 / 1024).toFixed(1)} MB` : ""}</p>
              </div>
            </motion.div>
          ) : step === "checking" ? (
            <motion.div key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CheckingPanel job={j} now={now} />
            </motion.div>
          ) : step === "applying" && j ? (
            <motion.div key="applying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ApplyingPanel job={j} now={now} />
            </motion.div>
          ) : step === "preview" && j ? (
            <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="lines in the sheet" value={j.total_rows} tone="neutral" />
                <Stat label="ready to add" value={j.valid_rows} tone="brand" />
                <Stat label="already exist" value={j.duplicate_rows} tone="warn" />
                <Stat label="have a problem" value={j.invalid_rows} tone="danger" />
              </div>
              {Number(j.result?.merged_rows ?? 0) > 0 ? (
                <p className="rounded-xl bg-brand-soft px-3.5 py-2 text-sm font-semibold text-brand-strong" data-testid="import-people-note">
                  {formatNumber(j.total_rows)} lines are {formatNumber(Number(j.result?.sheet_people ?? 0))} people with {formatNumber(Number(j.result?.sheet_numbers ?? 0))} numbers: {formatNumber(Number(j.result?.merged_rows ?? 0))} lines were another
                  number of a person who is on an earlier line - they are put together, one contact each.
                </p>
              ) : null}
              {j.file_duplicate_rows > 0 || j.existing_rows > 0 ? (
                <p className="text-xs text-muted" data-testid="import-duplicates-note">
                  {[
                    j.existing_rows > 0 ? `${pluralize(j.existing_rows, "number")} ${j.existing_rows === 1 ? "is a contact" : "are contacts"} already (${mode === "update" ? "they will be updated" : "they stay as they are"})` : "",
                    j.file_duplicate_rows > 0 ? `${pluralize(j.file_duplicate_rows, "line")} repeat${j.file_duplicate_rows === 1 ? "s" : ""} a number that is earlier in the same sheet (only the first is used)` : "",
                  ]
                    .filter(Boolean)
                    .join(", and ")}
                  .
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  name="imp-tab"
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  aria-label="What to look at"
                  options={[
                    { value: "sharing", label: "Who gets them" },
                    { value: "rows", label: "Lines of the sheet" },
                  ]}
                />
                {j.invalid_rows + j.duplicate_rows > 0 ? (
                  <Button asChild variant="ghost" size="xs" className="ml-auto">
                    <a href={downloadUrl(`contacts/import/${j.id}/issues.csv`)} download>
                      <Download className="size-3.5" /> Download the problem list ({formatNumber(j.invalid_rows + j.duplicate_rows)})
                    </a>
                  </Button>
                ) : null}
              </div>
              {tab === "sharing" ? (
                <ShareCard job={j} plan={plan} loading={planQuery.isPending} refreshing={planQuery.isFetching} share={share} onShare={pick} picked={picked} onPick={setPicked} strategy={strategy} onStrategy={setStrategy} order={order} onOrder={setOrder} />
              ) : (
                <RowsTable
                  rows={rows.data?.items}
                  loading={rows.isPending}
                  filter={rowFilter}
                  onFilter={(v) => {
                    setRowChoice(v);
                    setRowPage(1);
                  }}
                  page={rowPage}
                  total={rows.data?.total ?? 0}
                  onPage={setRowPage}
                />
              )}
            </motion.div>
          ) : step === "done" && j ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
              <div className="flex items-center gap-4 rounded-2xl bg-brand-soft p-5 text-brand-strong">
                <CheckCircle2 className="size-9 shrink-0" />
                <div>
                  <p className="text-lg font-extrabold" data-testid="import-result">
                    {pluralize(j.inserted_rows, "contact")} added
                  </p>
                  <p className="text-sm">
                    {j.updated_rows ? `${formatNumber(j.updated_rows)} updated · ` : ""}
                    {formatNumber(j.skipped_rows)} skipped
                    {j.assigned_rows ? ` · ${formatNumber(j.assigned_rows)} given to employees` : ""}
                  </p>
                </div>
              </div>
              <ResultTable job={j} />
              {j.invalid_rows + j.duplicate_rows > 0 ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={downloadUrl(`contacts/import/${j.id}/issues.csv`)} download>
                    <Download className="size-4" /> Download the lines that were not added ({formatNumber(j.invalid_rows + j.duplicate_rows)})
                  </a>
                </Button>
              ) : null}
            </motion.div>
          ) : step === "stopped" && j ? (
            <motion.div key="stopped" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="flex items-start gap-4 rounded-2xl bg-warn-soft p-5 text-warn">
                <OctagonX className="mt-0.5 size-6 shrink-0" />
                <div>
                  <p className="font-bold">Stopped after {formatNumber(j.applied_rows)} of {formatNumber(j.valid_rows)} contacts</p>
                  <p className="mt-1 text-sm">What was added stays in the system and with the employees. The rest was not added; upload the sheet again to add it (numbers that are contacts now are skipped).</p>
                </div>
              </div>
              <ResultTable job={j} />
            </motion.div>
          ) : (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="flex items-start gap-4 rounded-2xl bg-danger-soft p-5 text-danger">
                <AlertTriangle className="mt-0.5 size-6 shrink-0" />
                <div>
                  <p className="font-bold">{j?.confirmed_at ? "The import stopped half way" : "The sheet could not be processed"}</p>
                  <p className="mt-1 text-sm">{j?.error_message ?? "Something went wrong. Check that the file has a header row with a phone column, then try again."}</p>
                </div>
              </div>
              {j?.confirmed_at && j.applied_rows > 0 ? <ResultTable job={j} /> : null}
            </motion.div>
          )}
        </AnimatePresence>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {stopAsked ? (
          <div role="alertdialog" className="rounded-2xl border border-warn/40 bg-warn-soft p-4 text-sm text-warn">
            <p className="font-bold">Stop adding the contacts?</p>
            <p className="mt-1">Contacts that are already added stay, with the employees who got them. The rest of the sheet is not added.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setStopAsked(false)}>
                Keep adding
              </Button>
              <Button size="sm" variant="danger" onClick={() => void stop()} loading={cancel.isPending} data-testid="import-stop-yes">
                Stop
              </Button>
            </div>
          </div>
        ) : null}
      </DialogBody>

      <DialogFooter>
        {step === "setup" ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={start} disabled={!file} loading={busy} data-testid="import-start">
              Check the sheet
            </Button>
          </>
        ) : step === "preview" ? (
          <>
            <Button variant="secondary" onClick={() => void leave()}>
              Cancel import
            </Button>
            <Button onClick={apply} disabled={toAdd === 0 || cannotShare || nobodyChosen || planQuery.isError} loading={busy} data-testid="import-apply">
              {`Add ${pluralize(toAdd, "contact")}`}
            </Button>
          </>
        ) : step === "done" || step === "stopped" ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : step === "failed" ? (
          <>
            {j?.confirmed_at ? (
              <Button onClick={() => void carryOn()} loading={busy} data-testid="import-continue">
                Continue where it stopped
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setImportId(null);
                  setFile(null);
                  upload.reset();
                }}
              >
                Try another file
              </Button>
            )}
            <Button variant={j?.confirmed_at ? "secondary" : "primary"} onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </>
        ) : step === "applying" ? (
          <>
            <Button variant="secondary" onClick={() => setStopAsked(true)} disabled={!!j?.cancel_requested} data-testid="import-stop">
              {j?.cancel_requested ? "Stopping..." : "Stop"}
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close - it keeps going
            </Button>
          </>
        ) : step === "checking" ? (
          <Button variant="secondary" onClick={() => void leave()}>
            Cancel
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

// -------------------------------------------------------------------------------------------------------- progress
function CheckingPanel({ job, now }: { job: ImportJob | undefined; now: number }) {
  const stage = String(job?.result?.stage ?? "waiting");
  const compared = Number(job?.result?.compared ?? 0);
  const rate = rowsPerSecond(job?.scanned_rows ?? 0, job?.created_at, now);
  const percent = stage === "comparing" || stage === "grouping" ? 100 : (job?.progress_percent ?? 0);
  return (
    <div className="flex flex-col items-center py-12 text-center" data-testid="import-checking">
      <Loader2 className="size-10 animate-spin text-brand" />
      <p className="mt-4 text-base font-bold text-ink">{stage === "comparing" ? "Comparing with the contacts you already have..." : stage === "grouping" ? "Putting the numbers of the same person together..." : stage === "waiting" ? "Waiting for its turn..." : "Reading every line..."}</p>
      <div className="mt-4 w-full max-w-md">
        <ProgressBar value={stage === "comparing" ? Math.min(99, 90 + compared / Math.max(1, job?.valid_rows || compared || 1) * 9) : percent} label="Check" />
      </div>
      <p className="mt-2 text-sm text-muted tnum">
        {job && job.scanned_rows > 0 ? `${formatNumber(job.scanned_rows)} lines read` : "Starting"}
        {rate ? ` · ${formatNumber(Math.round(rate))} lines a second` : ""}
      </p>
    </div>
  );
}

function ApplyingPanel({ job, now }: { job: ImportJob; now: number }) {
  const employees = useEmployeeList({ role: "employee" });
  const total = Math.max(1, job.valid_rows + (job.mode === "update" ? job.existing_rows : 0));
  const done = job.applied_rows + (job.mode === "update" ? job.applied_existing : 0);
  const percent = Math.min(100, (done / total) * 100);
  const rate = rowsPerSecond(done, job.confirmed_at, now);
  const eta = formatEta(done, total, job.confirmed_at ? (now - Date.parse(job.confirmed_at)) / 1000 : 0);
  const names = new Map((employees.data?.items ?? []).map((e) => [String(e.id), e.full_name]));
  const given = Object.entries((job.result?.per_employee ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4" data-testid="import-applying">
      <div className="rounded-2xl border border-line p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-base font-bold text-ink">
            <span className="tnum">{formatNumber(done)}</span> of <span className="tnum">{formatNumber(total)}</span> contacts
          </p>
          <p className="text-sm font-semibold text-brand-strong tnum">{percent.toFixed(percent < 10 ? 1 : 0)}%</p>
        </div>
        <ProgressBar value={percent} label="Adding contacts" />
        <p className="mt-2 text-xs text-muted tnum">
          {rate ? `${formatNumber(Math.round(rate))} a second` : "Starting"}
          {eta ? ` · ${eta}` : ""}
          {job.attempts > 1 ? " · it was picked up again after a restart of the server and carries on where it was" : ""}
        </p>
      </div>
      {given.length > 0 ? (
        <TableWrap className="max-h-56 overflow-y-auto">
          <Table className="min-w-[420px]">
            <THead className="sticky top-0 z-10">
              <TR>
                <TH>Employee</TH>
                <TH className="text-right">Given so far</TH>
              </TR>
            </THead>
            <tbody>
              {given.map(([id, count]) => (
                <TR key={id}>
                  <TD className="font-semibold text-ink">{names.get(id) ?? `#${id}`}</TD>
                  <TD className="text-right tnum">{formatNumber(count)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : null}
    </div>
  );
}

function ResultTable({ job }: { job: ImportJob }) {
  const list = (job.result?.employees ?? []) as { employee_id: number; employee_code: string; full_name: string; count: number }[];
  if (list.length === 0) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
        <Users className="size-4" /> Who got them
      </p>
      <TableWrap className="max-h-64 overflow-y-auto">
        <Table className="min-w-[420px]">
          <THead className="sticky top-0 z-10">
            <TR>
              <TH>Employee</TH>
              <TH className="text-right">New contacts</TH>
            </TR>
          </THead>
          <tbody data-testid="import-employees">
            {list.map((e) => (
              <TR key={e.employee_id}>
                <TD>
                  <span className="font-semibold text-ink">{e.full_name}</span> <span className="text-xs text-muted">{e.employee_code}</span>
                </TD>
                <TD className="text-right tnum">{formatNumber(e.count)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------- sharing
function ShareCard({
  job,
  plan,
  loading,
  refreshing,
  share,
  onShare,
  picked,
  onPick,
  strategy,
  onStrategy,
  order,
  onOrder,
}: {
  job: ImportJob;
  plan: ImportPlan | undefined;
  loading: boolean;
  refreshing: boolean;
  share: ShareMode;
  onShare: (mode: ShareMode) => void;
  picked: number[];
  onPick: (ids: number[]) => void;
  strategy: PlanParams["strategy"];
  onStrategy: (s: PlanParams["strategy"]) => void;
  order: PlanParams["order"];
  onOrder: (o: PlanParams["order"]) => void;
}) {
  const toShare = plan?.to_distribute ?? Math.max(0, job.valid_rows - job.explicit_rows);
  if (job.valid_rows === 0) {
    return <p className="rounded-2xl border border-line p-5 text-sm text-muted">There is nothing new to give out: every valid line is a contact already.</p>;
  }
  const receiving = plan?.employees.filter((e) => e.receives) ?? [];
  const options: { value: ShareMode; title: string; text: string; disabled?: boolean }[] = [
    { value: "working", title: "Everybody who is working", text: plan ? `${plan.working > 0 || share !== "working" ? "" : "Nobody is working right now. "}Employees seen in the last ${plan.inactive_after_days} day${plan.inactive_after_days === 1 ? "" : "s"} (and new accounts) share them equally.` : "Employees who were seen recently share them equally." },
    { value: "chosen", title: "Only the employees I choose", text: "Pick the people yourself. Somebody who is not working still gets nothing." },
    { value: "none", title: "Nobody - add them without an owner", text: "You can hand them out later from the Contacts page." },
  ];
  return (
    <div className="space-y-4" data-testid="import-share">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who gets the new contacts">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={share === o.value}
            onClick={() => onShare(o.value)}
            data-testid={`share-${o.value}`}
            className={cn("rounded-2xl border p-3.5 text-left transition-colors", share === o.value ? "border-brand bg-brand-soft/60" : "border-line bg-surface hover:border-line-strong")}
          >
            <p className="text-sm font-bold text-ink">{o.title}</p>
            <p className="mt-0.5 text-xs text-muted">{o.text}</p>
          </button>
        ))}
      </div>

      {share !== "none" ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-soft">How many each</span>
            <Segmented
              name="imp-strategy"
              size="sm"
              value={strategy}
              onChange={onStrategy}
              aria-label="How many each"
              options={[
                { value: "equal", label: "The same for everybody" },
                { value: "balance_total", label: "Even out the work" },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-soft">Order</span>
            <Segmented
              name="imp-order"
              size="sm"
              value={order}
              onChange={onOrder}
              aria-label="Order"
              options={[
                { value: "interleave", label: "Mixed" },
                { value: "blocks", label: "In blocks" },
              ]}
            />
          </div>
          {refreshing ? <Loader2 className="size-4 animate-spin text-muted" aria-label="Updating" /> : null}
        </div>
      ) : null}

      {plan && share !== "none" && receiving.length > 0 ? (
        <p className="rounded-xl bg-brand-soft px-3.5 py-2 text-sm font-semibold text-brand-strong" data-testid="import-each">
          {strategy === "equal" ? eachText(toShare, receiving.length, formatNumber) : `${formatNumber(toShare)} contacts, the most to whoever has the least to call now`}
        </p>
      ) : null}
      {job.explicit_rows > 0 ? (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" /> {formatNumber(job.explicit_rows)} lines name their employee in the sheet and go to that person; the other {formatNumber(toShare)} are shared.
        </p>
      ) : null}
      {plan?.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-xl bg-warn-soft px-3.5 py-2 text-xs font-medium text-warn">
          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {w}
        </p>
      ))}

      {share === "none" ? null : loading ? (
        <Skeleton className="h-40 w-full" />
      ) : plan ? (
        <TableWrap className="max-h-72 overflow-y-auto">
          <Table className="min-w-[560px]">
            <THead className="sticky top-0 z-10">
              <TR>
                {share === "chosen" ? (
                  <TH className="w-10">
                    <Checkbox
                      checked={picked.length > 0 && picked.length === plan.employees.length}
                      onCheckedChange={(on) => onPick(on ? plan.employees.map((e) => e.employee_id) : [])}
                      aria-label="Choose everybody"
                    />
                  </TH>
                ) : null}
                <TH>Employee</TH>
                <TH>State</TH>
                <TH className="text-right">Has now</TH>
                <TH className="text-right">Gets</TH>
              </TR>
            </THead>
            <tbody>
              {plan.employees.map((e) => {
                const meta = WORK_STATE[e.state];
                const dim = share === "working" ? !e.receives : share === "chosen" ? !picked.includes(e.employee_id) || !e.receives : false;
                return (
                  <TR key={e.employee_id} className={cn(dim && "opacity-60")} data-testid="share-row">
                    {share === "chosen" ? (
                      <TD>
                        <Checkbox
                          checked={picked.includes(e.employee_id)}
                          onCheckedChange={() => onPick(picked.includes(e.employee_id) ? picked.filter((x) => x !== e.employee_id) : [...picked, e.employee_id])}
                          aria-label={e.full_name}
                        />
                      </TD>
                    ) : null}
                    <TD>
                      <span className="font-semibold text-ink">{e.full_name}</span> <span className="text-xs text-muted">{e.employee_code}</span>
                    </TD>
                    <TD>
                      <Badge tone={meta.tone} title={e.reason || meta.hint}>
                        {meta.label}
                      </Badge>
                      {e.reason ? <span className="ml-2 text-xs text-muted">{e.reason}</span> : null}
                    </TD>
                    <TD className="text-right tnum text-ink-soft">{formatNumber(e.assigned)}</TD>
                    <TD className="text-right font-bold tnum text-ink">{e.receives ? `+${formatNumber(e.planned)}${e.explicit ? ` (+${formatNumber(e.explicit)} named)` : ""}` : e.explicit ? `+${formatNumber(e.explicit)} named` : "-"}</TD>
                  </TR>
                );
              })}
              {plan.employees.length === 0 ? (
                <TR>
                  <TD colSpan={5} className="py-8 text-center text-muted">
                    There are no employees yet.
                  </TD>
                </TR>
              ) : null}
            </tbody>
          </Table>
        </TableWrap>
      ) : null}
    </div>
  );
}

function RowsTable({
  rows,
  loading,
  filter,
  onFilter,
  page,
  total,
  onPage,
}: {
  rows: { id: number; row_number: number; status: string; duplicate_of?: string | null; normalized_phone?: string | null; data: Record<string, unknown>; errors?: unknown[] | null }[] | undefined;
  loading: boolean;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="space-y-3">
      <Segmented
        name="imp-rows"
        size="sm"
        value={filter}
        onChange={onFilter}
        aria-label="Show"
        options={[
          { value: "all", label: "All" },
          { value: "valid", label: "Ready" },
          { value: "duplicate", label: "Existing" },
          { value: "invalid", label: "Problems" },
        ]}
      />
      <p className="text-xs text-muted">The first lines of each group are shown here. The download has every line with a problem.</p>
      <TableWrap className="max-h-72 overflow-y-auto">
        <Table className="min-w-[640px]">
          <THead className="sticky top-0 z-10">
            <TR>
              <TH>Line</TH>
              <TH>Name</TH>
              <TH>Phone</TH>
              <TH>Check</TH>
            </TR>
          </THead>
          <tbody>
            {loading ? (
              <TR>
                <TD colSpan={4}>
                  <Skeleton className="h-16 w-full" />
                </TD>
              </TR>
            ) : (
              rows?.map((r) => (
                <TR key={r.id}>
                  <TD className="tnum text-muted">{r.row_number}</TD>
                  <TD className="font-semibold text-ink">{String(r.data.name ?? "-")}</TD>
                  <TD className="tnum text-ink-soft">{r.normalized_phone ?? String(r.data.phone_raw ?? r.data.phone ?? "-")}</TD>
                  <TD>
                    {r.status === "valid" ? (
                      <Badge tone="brand">Ready</Badge>
                    ) : r.status === "duplicate" ? (
                      <span className="text-xs font-medium text-warn">{(r.errors ?? []).map(String).join(" ") || `Already exists${r.duplicate_of ? ` (${r.duplicate_of})` : ""}`}</span>
                    ) : (
                      <span className="text-xs font-medium text-danger">{(r.errors ?? []).map(String).join(" ") || "Not valid."}</span>
                    )}
                  </TD>
                </TR>
              ))
            )}
            {rows && rows.length === 0 ? (
              <TR>
                <TD colSpan={4} className="py-8 text-center text-muted">
                  Nothing in this group.
                </TD>
              </TR>
            ) : null}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination page={page} pageSize={15} total={total} onPage={onPage} />
    </div>
  );
}
