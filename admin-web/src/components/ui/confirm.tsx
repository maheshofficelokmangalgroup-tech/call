"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** The inside of the dialog. It is only mounted while the dialog is open, so an old error never shows up again. */
function ConfirmBody({ title, description, confirmLabel = "Confirm", danger = false, onConfirm, onOpenChange, busy, setBusy }: Omit<ConfirmProps, "open"> & { busy: boolean; setBusy: (busy: boolean) => void }) {
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className={`mb-2 flex size-12 items-center justify-center rounded-2xl ${danger ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
          <AlertTriangle className="size-6" />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {error ? (
        <p role="alert" className="mx-6 mb-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={run} loading={busy} data-testid="confirm-yes">
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Ask before anything destructive. `onConfirm` may be async: the dialog stays open (with a spinner) until it finishes. */
export function ConfirmDialog(props: ConfirmProps) {
  const { open, onOpenChange } = props;
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <ConfirmBody {...props} busy={busy} setBusy={setBusy} />
      </DialogContent>
    </Dialog>
  );
}
