"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Eye, EyeOff, UserPlus, UserRoundCog } from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { CredentialsCard, type Credentials } from "@/components/domain/credentials-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { useCreateEmployee, useSettings, useTeams, useUpdateEmployee } from "@/lib/queries";
import type { Employee } from "@/lib/types";

const schema = z
  .object({
    full_name: z.string().trim().min(2, "Enter the employee's full name."),
    email: z.string().trim().min(1, "Enter an email address.").email("Enter a valid email address."),
    phone: z.string().trim().max(32, "That number is too long."),
    employee_code: z
      .string()
      .trim()
      .max(32, "At most 32 characters.")
      .regex(/^([A-Za-z0-9_.-]{2,})?$/, "Use at least 2 letters, numbers, - or _."),
    role: z.enum(["employee", "manager", "admin"]),
    team_id: z.string(),
    daily_target: z.string().trim().regex(/^\d{1,4}$/, "Enter a number from 0 to 2000.").refine((v) => Number(v) <= 2000, "Enter a number from 0 to 2000."),
    password_mode: z.enum(["generate", "custom"]),
    password: z.string(),
    must_change_password: z.boolean(),
    device_binding_enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.password_mode !== "custom") return;
    if (v.password.length < 8) ctx.addIssue({ code: "custom", path: ["password"], message: "Use at least 8 characters." });
    else if (!/[A-Za-z]/.test(v.password) || !/\d/.test(v.password)) ctx.addIssue({ code: "custom", path: ["password"], message: "Use at least one letter and one number." });
  });

type Values = z.infer<typeof schema>;

const ROLE_HELP = {
  employee: "Makes calls from the mobile app. Cannot open this panel.",
  manager: "Can open this panel and see the team they belong to. Cannot change anything.",
  admin: "Can see everyone and change everything, including other administrators.",
} as const;

function defaults(employee: Employee | undefined, target: number): Values {
  return {
    full_name: employee?.full_name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    employee_code: employee?.employee_code ?? "",
    role: (employee?.role as Values["role"]) ?? "employee",
    team_id: employee?.team_id ? String(employee.team_id) : "none",
    daily_target: String(employee?.daily_target ?? target),
    password_mode: "generate",
    password: "",
    must_change_password: true,
    device_binding_enabled: employee?.device_binding_enabled ?? false,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** when given, the dialog edits this person instead of creating a new one */
  employee?: Employee;
  /** can the signed-in person assign roles (they cannot change their own) */
  selfId?: number;
}

/** One dialog for "New employee" and "Edit employee". After a new account is created it shows the login details to hand over. */
export function EmployeeFormDialog({ open, onOpenChange, employee, selfId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="employee-dialog">
        <EmployeeFormBody employee={employee} selfId={selfId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** The form itself. It is mounted only while the dialog is open, so every opening starts from clean values. */
function EmployeeFormBody({ employee, selfId, onOpenChange }: { employee?: Employee; selfId?: number; onOpenChange: (open: boolean) => void }) {
  const editing = employee !== undefined;
  const teams = useTeams();
  const settings = useSettings();
  const create = useCreateEmployee();
  const update = useUpdateEmployee(employee?.id ?? 0);
  const defaultTarget = settings.data?.default_daily_target ?? 50;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(employee, defaultTarget) });
  const [created, setCreated] = React.useState<Credentials | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const mode = useWatch({ control: form.control, name: "password_mode" });
  const role = useWatch({ control: form.control, name: "role" });

  // the target setting may arrive after the dialog opened: use it unless the administrator already typed a number
  React.useEffect(() => {
    if (!editing && !form.getFieldState("daily_target").isDirty) form.setValue("daily_target", String(defaultTarget));
  }, [defaultTarget, editing, form]);

  const { errors, isSubmitting } = form.formState;

  async function submit(values: Values) {
    setError(null);
    try {
      const teamId = values.team_id === "none" ? null : Number(values.team_id);
      if (editing && employee) {
        await update.mutateAsync({
          full_name: values.full_name,
          email: values.email,
          phone: values.phone,
          role: values.role === employee.role ? undefined : values.role,
          team_id: teamId ?? undefined,
          clear_team: teamId === null && employee.team_id !== null,
          daily_target: Number(values.daily_target),
          device_binding_enabled: values.device_binding_enabled,
        });
        toast.success("Changes saved", { description: values.full_name });
        onOpenChange(false);
        return;
      }
      const result = await create.mutateAsync({
        full_name: values.full_name,
        email: values.email,
        phone: values.phone || undefined,
        employee_code: values.employee_code || undefined,
        role: values.role,
        team_id: teamId,
        daily_target: Number(values.daily_target),
        password: values.password_mode === "custom" ? values.password : undefined,
        must_change_password: values.must_change_password,
        device_binding_enabled: values.device_binding_enabled,
      });
      setCreated({
        name: result.employee.full_name,
        employeeCode: result.employee.employee_code,
        email: result.employee.email,
        password: result.temporary_password ?? null,
        phone: result.employee.phone,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const ownRole = editing && employee?.id === selfId;

  if (created) {
    return (
      <>
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <CheckCircle2 className="size-6" />
          </div>
          <DialogTitle>{created.name} can sign in now</DialogTitle>
          <DialogDescription>The account is ready. Send these details to the employee, who signs in on the mobile app.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <CredentialsCard credentials={created} />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setCreated(null);
              form.reset(defaults(undefined, defaultTarget));
            }}
          >
            <UserPlus className="size-4" /> Add another
          </Button>
          <Button onClick={() => onOpenChange(false)} data-testid="employee-done">
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="flex min-h-0 flex-1 flex-col">
  <DialogHeader>
    <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">{editing ? <UserRoundCog className="size-6" /> : <UserPlus className="size-6" />}</div>
    <DialogTitle>{editing ? `Edit ${employee?.full_name}` : "New employee"}</DialogTitle>
    <DialogDescription>{editing ? "Change the details of this account. The employee ID cannot be changed." : "Create a login for someone who will make calls (or manage the people who do)."}</DialogDescription>
  </DialogHeader>

  <DialogBody className="space-y-5">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="ef-name" required error={errors.full_name?.message}>
        <Input id="ef-name" autoComplete="off" autoFocus placeholder="e.g. Rahul Patil" aria-invalid={!!errors.full_name} {...form.register("full_name")} />
      </Field>
      <Field label="Email" htmlFor="ef-email" required error={errors.email?.message} hint="The employee can sign in with this or with the employee ID.">
        <Input id="ef-email" type="email" autoComplete="off" placeholder="rahul@company.com" aria-invalid={!!errors.email} {...form.register("email")} />
      </Field>
      <Field label="Mobile number" htmlFor="ef-phone" error={errors.phone?.message} hint="Optional. Used to open WhatsApp with the login details.">
        <Input id="ef-phone" type="tel" autoComplete="off" placeholder="+91 98765 43210" aria-invalid={!!errors.phone} {...form.register("phone")} />
      </Field>
      <Field label="Employee ID" htmlFor="ef-code" error={errors.employee_code?.message} hint={editing ? "Fixed once created." : "Leave empty to get the next number automatically."}>
        <Input id="ef-code" autoComplete="off" placeholder="Automatic" disabled={editing} aria-invalid={!!errors.employee_code} {...form.register("employee_code")} className="font-mono uppercase" />
      </Field>
      <Field label="Role" htmlFor="ef-role" hint={ownRole ? "You cannot change your own role." : ROLE_HELP[role]}>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={ownRole}>
              <SelectTrigger id="ef-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee (mobile app)</SelectItem>
                <SelectItem value="manager">Manager (sees own team)</SelectItem>
                <SelectItem value="admin">Administrator (everything)</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Field label="Team" htmlFor="ef-team" hint="Managers see the employees of their own team.">
        <Controller
          control={form.control}
          name="team_id"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="ef-team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team</SelectItem>
                {teams.data?.map((team) => (
                  <SelectItem key={team.id} value={String(team.id)}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
      <Field label="Daily call target" htmlFor="ef-target" error={errors.daily_target?.message} hint="Calls the employee should make each day. 0 means no target.">
        <Input id="ef-target" inputMode="numeric" aria-invalid={!!errors.daily_target} {...form.register("daily_target")} />
      </Field>
    </div>

    {!editing ? (
      <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">Password</p>
            <p className="text-xs text-muted">{mode === "generate" ? "A strong password is made for you and shown once." : "You choose the password and tell it to the employee."}</p>
          </div>
          <Controller
            control={form.control}
            name="password_mode"
            render={({ field }) => (
              <Segmented
                name="pw-mode"
                size="sm"
                value={field.value}
                onChange={field.onChange}
                aria-label="Password choice"
                options={[
                  { value: "generate", label: "Generate" },
                  { value: "custom", label: "I will type one" },
                ]}
              />
            )}
          />
        </div>
        {mode === "custom" ? (
          <Field label="Password" htmlFor="ef-password" error={errors.password?.message} hint="At least 8 characters with a letter and a number; not the name or email.">
            <div className="relative">
              <Input id="ef-password" type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-11" aria-invalid={!!errors.password} {...form.register("password")} />
              <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-ink" aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        ) : null}
        <Controller
          control={form.control}
          name="must_change_password"
          render={({ field }) => (
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold text-ink">Ask for a new password at the first sign-in</span>
                <span className="block text-xs text-muted">Recommended: only the employee will know the final password.</span>
              </span>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </label>
          )}
        />
      </div>
    ) : null}

    <Controller
      control={form.control}
      name="device_binding_enabled"
      render={({ field }) => (
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line p-4">
          <span>
            <span className="block text-sm font-semibold text-ink">Allow only the first phone</span>
            <span className="block text-xs text-muted">The account works on the first phone it signs in from. Release the phone later from the employee page.</span>
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} />
        </label>
      )}
    />

    {error ? (
      <p role="alert" data-testid="employee-error" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
        {error}
      </p>
    ) : null}
  </DialogBody>

  <DialogFooter>
    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
      Cancel
    </Button>
    <Button type="submit" loading={isSubmitting} data-testid="employee-submit">
      {editing ? "Save changes" : "Create employee"}
    </Button>
  </DialogFooter>
    </form>
  );
}
