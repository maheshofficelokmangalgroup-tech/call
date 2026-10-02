"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z.string().min(8, "Use at least 8 characters.").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, { path: ["confirm"], message: "The two passwords do not match." });

type Values = z.infer<typeof schema>;

/** The form. It is mounted only while the dialog is open, so it always starts empty. */
function PasswordForm({ forced, onOpenChange }: { forced: boolean; onOpenChange: (open: boolean) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current_password: "", new_password: "", confirm: "" } });
  const [error, setError] = React.useState<string | null>(null);
  const queries = useQueryClient();

  async function submit(values: Values) {
    setError(null);
    try {
      await api("auth/change-password", { method: "POST", body: { current_password: values.current_password, new_password: values.new_password } });
      await queries.invalidateQueries(); // everything the page was waiting for (the server answered only this screen until now)
      toast.success("Password changed", { description: "Your other sign-ins were signed out." });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <DialogHeader>
        <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <KeyRound className="size-6" />
        </div>
        <DialogTitle>{forced ? "Choose a new password" : "Change password"}</DialogTitle>
        <DialogDescription>{forced ? "Your administrator gave you a temporary password. Set your own before you continue." : "Pick a strong password you do not use anywhere else."}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Current password" htmlFor="cp-current" error={errors.current_password?.message}>
          <Input id="cp-current" type="password" autoComplete="current-password" aria-invalid={!!errors.current_password} {...form.register("current_password")} />
        </Field>
        <Field label="New password" htmlFor="cp-new" error={errors.new_password?.message} hint="At least 8 characters, not your name or email.">
          <Input id="cp-new" type="password" autoComplete="new-password" aria-invalid={!!errors.new_password} {...form.register("new_password")} />
        </Field>
        <Field label="Repeat new password" htmlFor="cp-confirm" error={errors.confirm?.message}>
          <Input id="cp-confirm" type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...form.register("confirm")} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {forced ? null : (
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting} data-testid="password-submit">
          Save password
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ChangePasswordDialog({ open, onOpenChange, forced = false }: { open: boolean; onOpenChange: (open: boolean) => void; forced?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (forced && !next ? undefined : onOpenChange(next))}>
      <DialogContent size="sm" hideClose={forced}>
        <PasswordForm forced={forced} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
