"use client";

import { Eye, History, Info, KeyRound, ShieldCheck } from "lucide-react";
import * as React from "react";

import { CredentialsCard } from "@/components/domain/credentials-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useCredential } from "@/lib/queries";
import type { Employee } from "@/lib/types";
import { formatDate, pluralize } from "@/lib/utils";

/** The password an administrator handed out, looked at again. Every look is written to the audit log, so it only asks when it opens. */
export function CredentialsDialog({ employee, open, onOpenChange }: { employee: Pick<Employee, "id" | "full_name" | "employee_code" | "email" | "phone">; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="credentials-dialog">
        <Body employee={employee} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so the password is asked for when it opens and forgotten when it closes. */
function Body({ employee, onOpenChange }: { employee: Pick<Employee, "id" | "full_name" | "employee_code" | "email" | "phone">; onOpenChange: (open: boolean) => void }) {
  const credential = useCredential(employee.id, true);
  const c = credential.data;
  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Eye className="size-6" />
        </div>
        <DialogTitle>Login details of {employee.full_name}</DialogTitle>
        <DialogDescription>The password you gave this employee, for as long as they have not chosen their own.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {credential.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : credential.isError ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {errorMessage(credential.error)}
          </p>
        ) : c && c.available && c.password ? (
          <>
            <CredentialsCard
              credentials={{ name: c.full_name, employeeCode: c.employee_code, email: c.email, password: c.password, phone: c.phone }}
              title="Login details"
              showOnceWarning={false}
            />
            <ul className="space-y-1.5 text-xs text-muted">
              <li className="flex items-start gap-2">
                <History className="mt-px size-3.5 shrink-0" />
                <span>
                  {c.kind === "admin_set" ? "Typed by" : "Created for"} the employee{c.set_by ? ` by ${c.set_by}` : ""}
                  {c.set_at ? ` on ${formatDate(c.set_at)}` : ""}. {c.view_count > 1 ? `Looked at ${pluralize(c.view_count, "time")} (including now).` : "Looked at now for the first time."}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-px size-3.5 shrink-0" />
                <span>Every time this window opens, it is written to the audit log. The password is kept encrypted and removed when the employee chooses their own, when the account is deactivated, or after {pluralize(c.keep_days, "day")}.</span>
              </li>
              {c.must_change_password ? (
                <li className="flex items-start gap-2">
                  <Info className="mt-px size-3.5 shrink-0" />
                  <span>The employee has not changed it yet: the app asks for a new password at the first sign-in.</span>
                </li>
              ) : null}
            </ul>
          </>
        ) : c ? (
          <div className="rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink-soft" data-testid="credentials-unavailable">
            <p className="flex items-center gap-2 font-bold text-ink">
              <KeyRound className="size-4" /> There is no password to show
            </p>
            <p className="mt-1.5">
              {c.must_change_password
                ? `The saved password is gone (it is kept for ${pluralize(c.keep_days, "day")} at most, and removed when an account is deactivated).`
                : "Either they chose their own password - nobody can see that, on purpose - or the account was made before passwords were kept for you."}{" "}
              If they cannot sign in, use <b className="text-ink">Reset password</b> to create a new one.
            </p>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Close</Button>
      </DialogFooter>
    </>
  );
}
