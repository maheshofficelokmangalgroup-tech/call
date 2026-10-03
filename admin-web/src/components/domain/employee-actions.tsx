"use client";

import { Eye, KeyRound, Lock, LogOut, MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { CredentialsCard } from "@/components/domain/credentials-card";
import { CredentialsDialog } from "@/components/domain/credentials-dialog";
import { EmployeeFormDialog } from "@/components/domain/employee-form-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useEmployeeAction, useMe, useResetPassword } from "@/lib/queries";
import type { Employee } from "@/lib/types";

type Dialogs = "edit" | "reset" | "revoke" | "deactivate" | "activate" | "credentials" | null;

/** Everything an administrator can do to one employee, behind a "..." button. Managers only get "Open profile". */
export function EmployeeActions({ employee, showOpen = true, trigger }: { employee: Employee; showOpen?: boolean; trigger?: React.ReactNode }) {
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const selfId = me.data?.employee.id;
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const action = useEmployeeAction(employee.id);

  if (!isAdmin && !showOpen) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {trigger ?? (
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${employee.full_name}`} onClick={(e) => e.stopPropagation()} data-testid="employee-actions">
              <MoreHorizontal className="size-4" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {showOpen ? (
            <DropdownMenuItem asChild>
              <Link href={`/employees/${employee.id}`}>
                <Eye /> Open profile
              </Link>
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <>
              {showOpen ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => setDialog("edit")}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("credentials")} data-testid="show-password">
                <Lock /> Show password
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("reset")}>
                <KeyRound /> Reset password
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("revoke")}>
                <LogOut /> Sign out of all phones
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {employee.is_active ? (
                <DropdownMenuItem danger disabled={employee.id === selfId} onSelect={() => setDialog("deactivate")}>
                  <UserX /> Deactivate
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setDialog("activate")}>
                  <UserCheck /> Activate again
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {isAdmin ? (
        <>
          <EmployeeFormDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} employee={employee} selfId={selfId} />
          <ResetPasswordDialog open={dialog === "reset"} onOpenChange={(o) => !o && setDialog(null)} employee={employee} />
          <CredentialsDialog open={dialog === "credentials"} onOpenChange={(o) => !o && setDialog(null)} employee={employee} />
          <ConfirmDialog
            open={dialog === "revoke"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Sign ${employee.full_name} out everywhere?`}
            description="Every phone this person is signed in on is signed out at once. They can sign in again with their password."
            confirmLabel="Sign out"
            onConfirm={async () => {
              await action.mutateAsync("revoke-sessions");
              toast.success("Signed out of all phones", { description: employee.full_name });
            }}
          />
          <ConfirmDialog
            open={dialog === "deactivate"}
            onOpenChange={(o) => !o && setDialog(null)}
            danger
            title={`Deactivate ${employee.full_name}?`}
            description="They are signed out right away and cannot sign in again. Their calls and recordings stay in the panel. You can activate the account again at any time."
            confirmLabel="Deactivate"
            onConfirm={async () => {
              await action.mutateAsync("deactivate");
              toast.success("Account deactivated", { description: employee.full_name });
            }}
          />
          <ConfirmDialog
            open={dialog === "activate"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Activate ${employee.full_name} again?`}
            description="They can sign in with their existing password."
            confirmLabel="Activate"
            onConfirm={async () => {
              await action.mutateAsync("activate");
              toast.success("Account activated", { description: employee.full_name });
            }}
          />
        </>
      ) : null}
    </>
  );
}

function ResetPasswordDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (open: boolean) => void; employee: Employee }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <ResetPasswordBody employee={employee} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it always starts from the question and never shows an old password. */
function ResetPasswordBody({ onOpenChange, employee }: { onOpenChange: (open: boolean) => void; employee: Employee }) {
  const reset = useResetPassword(employee.id);
  const [custom, setCustom] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setError(null);
    if (custom && password.length < 8) {
      setError("Use at least 8 characters, with a letter and a number.");
      return;
    }
    try {
      const out = await reset.mutateAsync(custom ? password : undefined);
      setResult(out.temporary_password);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-warn-soft text-warn">
          <KeyRound className="size-6" />
        </div>
        <DialogTitle>{result ? "New password is ready" : `Reset password for ${employee.full_name}`}</DialogTitle>
        <DialogDescription>{result ? "Send it to the employee now - it is not shown again." : "They are signed out of every phone and must choose a new password the next time they sign in."}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {result ? (
          <CredentialsCard credentials={{ name: employee.full_name, employeeCode: employee.employee_code, email: employee.email, password: result, phone: employee.phone }} title="New login details" />
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-ink-soft">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} className="size-4 accent-[var(--brand)]" />
              I want to choose the password myself
            </label>
            {custom ? (
              <Field label="New password" htmlFor="rp-password" hint="At least 8 characters with a letter and a number.">
                <Input id="rp-password" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {result ? (
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={run} loading={reset.isPending} data-testid="reset-confirm">
              Reset password
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
