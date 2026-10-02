"use client";

import { Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useContactMutations, useEmployeeList } from "@/lib/queries";
import type { AssignRequest } from "@/lib/types";
import { cn, pluralize } from "@/lib/utils";

interface AssignProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** how many contacts are going to be handed out, for the wording */
  count: number;
  /** which contacts: explicit ids, or a filter (the rest of the request is filled in here) */
  request: Partial<Pick<AssignRequest, "contact_ids" | "q" | "status" | "category" | "unassigned_only" | "campaign_id">>;
  onDone?: () => void;
}

/** Hand a set of contacts to one or more employees: all to one person, or spread evenly. */
export function AssignDialog({ open, onOpenChange, ...rest }: AssignProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="assign-dialog">
        <AssignBody onOpenChange={onOpenChange} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so the choices start empty each time. */
function AssignBody({ onOpenChange, count, request, onDone }: Omit<AssignProps, "open">) {
  const employees = useEmployeeList({ isActive: true, role: "employee" });
  const { assign } = useContactMutations();
  const [picked, setPicked] = React.useState<number[]>([]);
  const [strategy, setStrategy] = React.useState<"round_robin" | "balanced">("balanced");
  const [reassign, setReassign] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (id: number) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function run() {
    setError(null);
    try {
      const result = await assign.mutateAsync({
        unassigned_only: false,
        ...request,
        employee_ids: picked,
        strategy: picked.length === 1 ? "single" : strategy,
        reassign,
      });
      const parts = [`${pluralize(result.assigned, "contact")} assigned`];
      if (result.reassigned) parts.push(`${result.reassigned} moved`);
      if (result.skipped_already_assigned) parts.push(`${result.skipped_already_assigned} already had an owner`);
      toast.success(parts.join(" · "));
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Send className="size-6" />
          </div>
          <DialogTitle>Give {pluralize(count, "contact")} to employees</DialogTitle>
          <DialogDescription>They appear in the call list on the employee&apos;s phone. Choose one person, or several to share the contacts.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border border-line p-2" role="group" aria-label="Employees">
            {employees.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              employees.data?.items.map((e) => {
                const on = picked.includes(e.id);
                return (
                  <label key={e.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors", on ? "bg-brand-soft" : "hover:bg-surface-2")}>
                    <Checkbox checked={on} onCheckedChange={() => toggle(e.id)} aria-label={e.full_name} />
                    <Avatar name={e.full_name} size="sm" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold text-ink">{e.full_name}</span>
                      <span className="block truncate text-xs text-muted">
                        {e.employee_code} · {e.team_name ?? "No team"}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>

          {picked.length > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-ink-soft">Share them</span>
              <Segmented
                name="assign-strategy"
                size="sm"
                value={strategy}
                onChange={setStrategy}
                aria-label="How to share"
                options={[
                  { value: "balanced", label: "Evenly by workload" },
                  { value: "round_robin", label: "One by one" },
                ]}
              />
            </div>
          ) : null}

          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <Checkbox checked={reassign} onCheckedChange={(v) => setReassign(v === true)} className="mt-0.5" />
            <span>
              <span className="block font-semibold text-ink">Also take contacts away from their current owner</span>
              <span className="block text-xs text-muted">Off: contacts that already belong to somebody stay where they are.</span>
            </span>
          </label>

          {error ? (
            <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={picked.length === 0} loading={assign.isPending} data-testid="assign-confirm">
            Give to {picked.length === 0 ? "employees" : pluralize(picked.length, "employee")}
          </Button>
      </DialogFooter>
    </>
  );
}
