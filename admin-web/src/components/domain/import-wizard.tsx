"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { downloadUrl, errorMessage } from "@/lib/api";
import { useCampaigns, useEmployeeList, useImport, useImportMutations, useImportRows, useSettings } from "@/lib/queries";
import { PRIORITY_LABEL } from "@/lib/status";
import { cn, downloadText, formatNumber, pluralize } from "@/lib/utils";

const MAX_BYTES = 25 * 1024 * 1024;
const SAMPLE = ["name,phone,email,city,category,tags,priority,Company", 'Rahul Sharma,9822012345,rahul@example.com,Pune,Retail,"vip, repeat",high,Sahyadri Traders', "Sneha Patil,+91 98765 43210,,Nashik,Wholesale,,normal,Omkar Enterprises"].join("\r\n");

type Step = "setup" | "checking" | "preview" | "applying" | "done" | "failed";
type RowFilter = "all" | "valid" | "invalid" | "duplicate";

function Stat({ label, value, tone }: { label: string; value: number; tone: "brand" | "danger" | "warn" | "neutral" }) {
  const styles = { brand: "bg-brand-soft text-brand-strong", danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-soft" }[tone];
  return (
    <div className={cn("rounded-2xl p-4", styles)}>
      <p className="text-2xl font-extrabold leading-none tnum">{formatNumber(value)}</p>
      <p className="mt-1 text-xs font-semibold">{label}</p>
    </div>
  );
}

/** Upload a contact sheet, check it, look at the result and only then apply it. */
export function ImportWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent size="xl" data-testid="import-dialog" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} hideClose>
        <ImportBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted only while the wizard is open, so every opening starts at the first step. Where the person is in the process
 * follows the status the server reports for the import, not a copy of it kept here.
 */
function ImportBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const settings = useSettings();
  const campaigns = useCampaigns();
  const employees = useEmployeeList({ isActive: true, role: "employee" });
  const { upload, confirm, cancel } = useImportMutations();

  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [modeChoice, setModeChoice] = React.useState<"skip" | "update" | null>(null);
  const [campaign, setCampaign] = React.useState("none");
  const [picked, setPicked] = React.useState<number[]>([]);
  const [strategy, setStrategy] = React.useState<"round_robin" | "balanced">("balanced");
  const [priority, setPriority] = React.useState("2");
  const [importId, setImportId] = React.useState<number | null>(null);
  const [rowChoice, setRowChoice] = React.useState<RowFilter | null>(null);
  const [rowPage, setRowPage] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);

  const job = useImport(importId);
  const j = job.data;
  const status = j?.status;
  const step: Step =
    importId === null ? "setup" : !status || status === "validating" ? "checking" : status === "previewed" ? "preview" : status === "applying" ? "applying" : status === "completed" ? "done" : "failed";

  const mode = modeChoice ?? settings.data?.duplicate_policy ?? "skip";
  const rowFilter: RowFilter = rowChoice ?? (j && j.invalid_rows > 0 ? "invalid" : j && j.duplicate_rows > 0 ? "duplicate" : "all");
  const rows = useImportRows(step === "preview" ? importId : null, rowFilter === "all" ? undefined : rowFilter, rowPage);

  function choose(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    if (!/\.(csv|xlsx|txt)$/i.test(f.name)) {
      setFileError("Choose a .csv or .xlsx file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("That file is larger than 25 MB.");
      return;
    }
    setFile(f);
  }

  async function start() {
    if (!file) return;
    setError(null);
    try {
      const created = await upload.mutateAsync({ file, mode, campaignId: campaign === "none" ? null : Number(campaign), employeeIds: picked, strategy, priority: Number(priority) });
      setImportId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function apply() {
    if (importId === null) return;
    setError(null);
    try {
      await confirm.mutateAsync({ id: importId, mode });
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

  const busy = upload.isPending || confirm.isPending;
  const title =
    step === "done" ? "Import finished" : step === "preview" ? "Check the sheet" : step === "failed" ? "The import could not finish" : step === "applying" ? "Adding contacts..." : step === "checking" ? "Checking your sheet..." : "Import contacts from a sheet";
  const toAdd = j ? j.valid_rows + (mode === "update" ? j.duplicate_rows : 0) : 0;

  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <FileSpreadsheet className="size-6" />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {step === "setup" ? "Upload an Excel or CSV file with a header row. Nothing is added until you have seen the check." : step === "preview" ? "Review what will happen. You can still cancel." : step === "done" ? "The contacts are in the system." : "This takes a few seconds."}
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
                <span className="mt-1 text-sm text-muted">{file ? `${(file.size / 1024).toFixed(0)} KB · click to choose another` : ".csv or .xlsx, up to 25 MB"}</span>
              </label>
              {fileError ? (
                <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
                  {fileError}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold text-ink-soft">Share new contacts with (optional)</p>
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-1.5">
                    {employees.isPending ? (
                      <Skeleton className="h-20 w-full" />
                    ) : (
                      employees.data?.items.map((e) => (
                        <label key={e.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm", picked.includes(e.id) ? "bg-brand-soft" : "hover:bg-surface-2")}>
                          <Checkbox checked={picked.includes(e.id)} onCheckedChange={() => setPicked((cur) => (cur.includes(e.id) ? cur.filter((x) => x !== e.id) : [...cur, e.id]))} aria-label={e.full_name} />
                          <span className="truncate font-medium text-ink">{e.full_name}</span>
                        </label>
                      ))
                    )}
                  </div>
                  {picked.length > 1 ? (
                    <Segmented
                      name="imp-strategy"
                      size="sm"
                      value={strategy}
                      onChange={setStrategy}
                      aria-label="How to share"
                      options={[
                        { value: "balanced", label: "Evenly" },
                        { value: "round_robin", label: "One by one" },
                      ]}
                    />
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4 text-sm">
                <p className="text-muted">
                  The sheet needs a <b className="text-ink">name</b> and a <b className="text-ink">phone</b> column. Email, city, category, tags, priority and any other column are optional.
                </p>
                <Button variant="secondary" size="sm" onClick={() => downloadText("contacts-sample.csv", SAMPLE)}>
                  <Download className="size-4" /> Sample file
                </Button>
              </div>
            </motion.div>
          ) : step === "checking" || step === "applying" ? (
            <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-14 text-center">
              <Loader2 className="size-10 animate-spin text-brand" />
              <p className="mt-4 text-base font-bold text-ink">{step === "checking" ? "Reading every line..." : "Adding the contacts..."}</p>
              <p className="mt-1 text-sm text-muted">{j && j.total_rows > 0 ? `${formatNumber(j.total_rows)} lines` : "Starting"}</p>
            </motion.div>
          ) : step === "preview" && j ? (
            <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Stat label="lines in the sheet" value={j.total_rows} tone="neutral" />
                <Stat label="ready to add" value={j.valid_rows} tone="brand" />
                <Stat label="already exist" value={j.duplicate_rows} tone="warn" />
                <Stat label="have a problem" value={j.invalid_rows} tone="danger" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  name="imp-rows"
                  size="sm"
                  value={rowFilter}
                  onChange={(v) => {
                    setRowChoice(v);
                    setRowPage(1);
                  }}
                  aria-label="Show"
                  options={[
                    { value: "all", label: "All" },
                    { value: "valid", label: "Ready" },
                    { value: "duplicate", label: "Existing" },
                    { value: "invalid", label: "Problems" },
                  ]}
                />
                {j.invalid_rows + j.duplicate_rows > 0 ? (
                  <Button asChild variant="ghost" size="xs" className="ml-auto">
                    <a href={downloadUrl(`contacts/import/${j.id}/issues.csv`)} download>
                      <Download className="size-3.5" /> Download the problem list
                    </a>
                  </Button>
                ) : null}
              </div>
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
                    {rows.isPending ? (
                      <TR>
                        <TD colSpan={4}>
                          <Skeleton className="h-16 w-full" />
                        </TD>
                      </TR>
                    ) : (
                      rows.data?.items.map((r) => (
                        <TR key={r.id}>
                          <TD className="tnum text-muted">{r.row_number}</TD>
                          <TD className="font-semibold text-ink">{String(r.data.name ?? "-")}</TD>
                          <TD className="tnum text-ink-soft">{r.normalized_phone ?? String(r.data.phone ?? "-")}</TD>
                          <TD>
                            {r.status === "valid" ? (
                              <Badge tone="brand">Ready</Badge>
                            ) : r.status === "duplicate" ? (
                              <span className="text-xs font-medium text-warn">Already exists{r.duplicate_of ? ` (${r.duplicate_of})` : ""}</span>
                            ) : (
                              <span className="text-xs font-medium text-danger">{(r.errors ?? []).map(String).join(" ") || "Not valid."}</span>
                            )}
                          </TD>
                        </TR>
                      ))
                    )}
                    {rows.data && rows.data.items.length === 0 ? (
                      <TR>
                        <TD colSpan={4} className="py-8 text-center text-muted">
                          Nothing in this group.
                        </TD>
                      </TR>
                    ) : null}
                  </tbody>
                </Table>
              </TableWrap>
              <Pagination page={rowPage} pageSize={15} total={rows.data?.total ?? 0} onPage={setRowPage} />
            </motion.div>
          ) : step === "done" && j ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
              <div className="flex items-center gap-4 rounded-2xl bg-brand-soft p-5 text-brand-strong">
                <CheckCircle2 className="size-9" />
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
            </motion.div>
          ) : (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-4 rounded-2xl bg-danger-soft p-5 text-danger">
              <AlertTriangle className="mt-0.5 size-6 shrink-0" />
              <div>
                <p className="font-bold">The sheet could not be processed</p>
                <p className="mt-1 text-sm">{j?.error_message ?? "Something went wrong. Check that the file has a header row with a phone column, then try again."}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
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
            <Button onClick={apply} disabled={toAdd === 0} loading={busy} data-testid="import-apply">
              {`Add ${pluralize(toAdd, "contact")}`}
            </Button>
          </>
        ) : step === "done" ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : step === "failed" ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setImportId(null);
                setFile(null);
              }}
            >
              Try another file
            </Button>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => void leave()} disabled={step === "applying"}>
            Cancel
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
