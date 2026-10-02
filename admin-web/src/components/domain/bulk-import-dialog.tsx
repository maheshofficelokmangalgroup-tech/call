"use client";

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, UploadCloud, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { SAMPLE_CSV, credentialsSheet, parseEmployeeSheet, type ImportLine, type ParsedSheet } from "@/lib/employee-import";
import { useBulkCreateEmployees, useSettings, useTeams } from "@/lib/queries";
import type { Employee } from "@/lib/types";
import { cn, downloadText, formatNumber, pluralize } from "@/lib/utils";

interface Outcome {
  line: ImportLine;
  ok: boolean;
  error?: string | null;
  employee?: Employee | null;
  password?: string | null;
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Create many employees from a spreadsheet: choose a file, check every line, import, then download the login sheet. */
export function BulkImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="xl" data-testid="bulk-dialog">
        <BulkImportBody onOpenChange={onOpenChange} busy={busy} setBusy={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts at "choose a file". */
function BulkImportBody({ onOpenChange, busy, setBusy }: { onOpenChange: (open: boolean) => void; busy: boolean; setBusy: (busy: boolean) => void }) {
  const teams = useTeams();
  const settings = useSettings();
  const bulk = useBulkCreateEmployees();
  const [sheet, setSheet] = React.useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<Outcome[] | null>(null);

  async function load(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setFileError("Please choose a .csv file. In Excel: File → Save As → CSV.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("That file is larger than 2 MB. Split it into smaller sheets.");
      return;
    }
    const parsed = parseEmployeeSheet(await file.text(), teams.data ?? [], settings.data?.default_daily_target ?? 50);
    if (parsed.missing.length > 0) {
      setFileError(`The sheet needs a "${parsed.missing.join('" and "')}" column. Download the sample to see the layout.`);
      return;
    }
    if (parsed.lines.length === 0) {
      setFileError("The sheet has no rows below the header line.");
      return;
    }
    if (parsed.lines.length > 500) {
      setFileError("Import at most 500 employees at a time.");
      return;
    }
    setFileName(file.name);
    setSheet(parsed);
  }

  const ready = sheet?.lines.filter((l) => l.payload) ?? [];
  const broken = sheet?.lines.filter((l) => !l.payload) ?? [];

  async function run() {
    if (!sheet || ready.length === 0) return;
    setBusy(true);
    const results: Outcome[] = [];
    try {
      for (let i = 0; i < ready.length; i += 100) {
        const chunk = ready.slice(i, i + 100);
        const out = await bulk.mutateAsync(chunk.map((l) => l.payload!));
        for (const r of out.results) {
          const line = chunk[r.index]!;
          results.push({ line, ok: r.ok, error: r.error, employee: r.employee, password: r.temporary_password ?? (line.password || null) });
        }
      }
      setOutcomes(results);
      const created = results.filter((r) => r.ok).length;
      toast.success(`${pluralize(created, "employee")} created`);
    } catch (e) {
      toast.error(errorMessage(e));
      if (results.length > 0) setOutcomes(results);
    } finally {
      setBusy(false);
    }
  }

  function downloadSheet() {
    const rows = (outcomes ?? [])
      .filter((o) => o.ok && o.employee)
      .map((o) => ({ name: o.employee!.full_name, employeeCode: o.employee!.employee_code, email: o.employee!.email, password: o.password ?? "(chosen by you)" }));
    downloadText(`employee-logins-${new Date().toISOString().slice(0, 10)}.csv`, credentialsSheet(rows));
  }

  const created = outcomes?.filter((o) => o.ok).length ?? 0;
  const failed = (outcomes?.length ?? 0) - created;

  return (
    <>
      <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Users className="size-6" />
          </div>
          <DialogTitle>{outcomes ? "Import finished" : "Add many employees from a sheet"}</DialogTitle>
          <DialogDescription>
            {outcomes ? "Download the login sheet now: the generated passwords are not shown again." : "Upload a CSV file (from Excel or Google Sheets). Every line is checked before anything is created."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <AnimatePresence mode="wait" initial={false}>
            {outcomes ? (
              <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-2xl bg-brand-soft p-4 text-brand-strong">
                    <CheckCircle2 className="size-6" />
                    <div>
                      <p className="text-2xl font-extrabold leading-none tnum" data-testid="bulk-created">{formatNumber(created)}</p>
                      <p className="text-xs font-semibold">created</p>
                    </div>
                  </div>
                  <div className={cn("flex items-center gap-3 rounded-2xl p-4", failed ? "bg-danger-soft text-danger" : "bg-surface-3 text-muted")}>
                    <AlertTriangle className="size-6" />
                    <div>
                      <p className="text-2xl font-extrabold leading-none tnum">{formatNumber(failed)}</p>
                      <p className="text-xs font-semibold">not created</p>
                    </div>
                  </div>
                </div>
                <TableWrap className="max-h-72 overflow-y-auto">
                  <Table className="min-w-[560px]">
                    <THead className="sticky top-0">
                      <TR>
                        <TH>Line</TH>
                        <TH>Name</TH>
                        <TH>Employee ID</TH>
                        <TH>Result</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {outcomes.map((o) => (
                        <TR key={o.line.line}>
                          <TD className="tnum text-muted">{o.line.line}</TD>
                          <TD className="font-semibold text-ink">{o.line.full_name}</TD>
                          <TD className="font-mono text-xs">{o.employee?.employee_code ?? "-"}</TD>
                          <TD>{o.ok ? <Badge tone="brand">Created</Badge> : <span className="text-sm font-medium text-danger">{o.error ?? "Could not be created."}</span>}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </motion.div>
            ) : !sheet ? (
              <motion.div key="pick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void load(e.dataTransfer.files[0]);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                    dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:border-brand/60 hover:bg-brand-soft/40",
                  )}
                >
                  <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void load(e.target.files?.[0])} data-testid="bulk-file" />
                  <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface text-brand shadow-pop">
                    <UploadCloud className="size-7" />
                  </span>
                  <span className="text-base font-bold text-ink">Drop your CSV file here</span>
                  <span className="mt-1 text-sm text-muted">or click to choose it from your computer</span>
                </label>
                {fileError ? (
                  <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
                    {fileError}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4">
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="mt-0.5 size-5 text-brand" />
                    <div className="text-sm">
                      <p className="font-bold text-ink">What the sheet looks like</p>
                      <p className="text-muted">
                        Columns: <b>name</b>, <b>email</b> (needed) and phone, employee_id, team, role, daily_target (optional). Passwords are generated for you.
                      </p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => downloadText("employees-sample.csv", SAMPLE_CSV)}>
                    <Download className="size-4" /> Sample file
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone="outline" className="max-w-full truncate">
                    <FileSpreadsheet className="size-3.5" /> {fileName}
                  </Badge>
                  <Badge tone="brand" data-testid="bulk-ready">{pluralize(ready.length, "line")} ready</Badge>
                  {broken.length > 0 ? <Badge tone="danger">{pluralize(broken.length, "line")} with a problem</Badge> : null}
                  {sheet.ignored.length > 0 ? <span className="text-xs text-muted">Ignored columns: {sheet.ignored.join(", ")}</span> : null}
                  <Button variant="ghost" size="xs" className="ml-auto" onClick={() => { setSheet(null); setFileName(""); }}>
                    Choose another file
                  </Button>
                </div>
                <TableWrap className="max-h-[360px] overflow-y-auto">
                  <Table className="min-w-[680px]">
                    <THead className="sticky top-0 z-10">
                      <TR>
                        <TH>Line</TH>
                        <TH>Name</TH>
                        <TH>Email</TH>
                        <TH>Team</TH>
                        <TH>Role</TH>
                        <TH>Check</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {sheet.lines.map((l) => (
                        <TR key={l.line} className={l.payload ? undefined : "bg-danger-soft/40"}>
                          <TD className="tnum text-muted">{l.line}</TD>
                          <TD className="font-semibold text-ink">{l.full_name || "-"}</TD>
                          <TD className="text-ink-soft">{l.email || "-"}</TD>
                          <TD className="text-ink-soft">{l.team || "-"}</TD>
                          <TD className="capitalize text-ink-soft">{l.role}</TD>
                          <TD>{l.payload ? <Badge tone="brand">Ready</Badge> : <span className="text-xs font-medium text-danger">{l.problems.join(" ")}</span>}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                {broken.length > 0 ? <p className="text-xs text-muted">Lines with a problem are skipped. Fix them in the sheet and import that sheet again, or continue with the ready lines.</p> : null}
              </motion.div>
            )}
          </AnimatePresence>
        </DialogBody>

        <DialogFooter>
          {outcomes ? (
            <>
              <Button variant="secondary" onClick={downloadSheet} disabled={created === 0} data-testid="bulk-download">
                <Download className="size-4" /> Download login sheet
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={run} disabled={!sheet || ready.length === 0} loading={busy} data-testid="bulk-run">
                {ready.length > 0 ? `Create ${pluralize(ready.length, "employee")}` : "Create employees"}
              </Button>
            </>
          )}
      </DialogFooter>
    </>
  );
}
