"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2, Users, UsersRound } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { useMe, useTeamMutations, useTeams } from "@/lib/queries";
import type { Team } from "@/lib/types";
import { cn, hueOf, pluralize } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(2, "Enter a name for the team.").max(100, "At most 100 characters."),
  description: z.string().trim().max(255, "At most 255 characters."),
  is_active: z.boolean(),
});
type Values = z.infer<typeof schema>;

function TeamDialog({ open, onOpenChange, team }: { open: boolean; onOpenChange: (open: boolean) => void; team: Team | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <TeamForm team={team} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it always starts from the team (or from empty fields). */
function TeamForm({ team, onOpenChange }: { team: Team | null; onOpenChange: (open: boolean) => void }) {
  const { create, update } = useTeamMutations();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: team?.name ?? "", description: team?.description ?? "", is_active: team?.is_active ?? true } });
  const [error, setError] = React.useState<string | null>(null);
  const active = useWatch({ control: form.control, name: "is_active" });

  async function submit(values: Values) {
    setError(null);
    try {
      if (team) {
        await update.mutateAsync({ id: team.id, name: values.name, description: values.description || null, is_active: values.is_active });
        toast.success("Team saved", { description: values.name });
      } else {
        await create.mutateAsync({ name: values.name, description: values.description || null });
        toast.success("Team created", { description: values.name });
      }
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <>
      <form onSubmit={form.handleSubmit(submit)} noValidate>
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <UsersRound className="size-6" />
            </div>
            <DialogTitle>{team ? "Edit team" : "New team"}</DialogTitle>
            <DialogDescription>Teams group employees. A manager sees the people of the team they belong to.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Team name" htmlFor="tm-name" required error={errors.name?.message}>
              <Input id="tm-name" autoFocus placeholder="e.g. Sales Team A" aria-invalid={!!errors.name} {...form.register("name")} data-testid="team-name" />
            </Field>
            <Field label="Description" htmlFor="tm-desc" error={errors.description?.message} hint="Optional.">
              <Textarea id="tm-desc" rows={3} {...form.register("description")} />
            </Field>
            {team ? (
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line p-4">
                <span>
                  <span className="block text-sm font-semibold text-ink">Team is active</span>
                  <span className="block text-xs text-muted">Inactive teams stay in reports but are hidden when you add people.</span>
                </span>
                <Switch checked={active} onCheckedChange={(v) => form.setValue("is_active", v, { shouldDirty: true })} />
              </label>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} data-testid="team-submit">
              {team ? "Save team" : "Create team"}
            </Button>
          </DialogFooter>
      </form>
    </>
  );
}

export function TeamsView() {
  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const teams = useTeams();
  const { remove } = useTeamMutations();
  const [editing, setEditing] = React.useState<Team | null>(null);
  const [dialog, setDialog] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Team | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Teams"
        description="Group your employees. Managers can see the people of their own team."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialog(true);
              }}
              data-testid="new-team"
            >
              <Plus className="size-4" /> New team
            </Button>
          ) : undefined
        }
      />

      {teams.isError ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The teams could not be loaded." onRetry={() => teams.refetch()} />
        </div>
      ) : teams.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : teams.data.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <EmptyState
            icon={UsersRound}
            title="No teams yet"
            description="Create a team, then choose it when you add employees."
            action={
              isAdmin ? (
                <Button onClick={() => setDialog(true)}>
                  <Plus className="size-4" /> New team
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="team-grid">
          {teams.data.map((team, i) => {
            const hue = hueOf(team.name);
            return (
              <motion.article
                key={team.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={cn("card-lift group relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card", !team.is_active && "opacity-70")}
                data-testid="team-card"
              >
                <div className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-20 blur-2xl" style={{ background: `hsl(${hue} 70% 50%)` }} />
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl text-white shadow-pop" style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 38) % 360} 66% 40%))` }}>
                    <UsersRound className="size-6" />
                  </span>
                  {!team.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                </div>
                <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink">{team.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted">{team.description ?? "No description."}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                  <Link href={`/employees?team=${team.id}`} className="inline-flex items-center gap-2 text-sm font-bold text-brand hover:underline">
                    <Users className="size-4" /> {pluralize(team.member_count, "member")}
                  </Link>
                  {isAdmin ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${team.name}`}
                        onClick={() => {
                          setEditing(team);
                          setDialog(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${team.name}`} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDeleting(team)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {isAdmin ? (
        <>
          <TeamDialog open={dialog} onOpenChange={setDialog} team={editing} />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(o) => !o && setDeleting(null)}
            danger
            title={`Delete ${deleting?.name}?`}
            description={deleting && deleting.member_count > 0 ? `${pluralize(deleting.member_count, "person", "people")} will be left without a team. Their calls are not affected.` : "The team is removed. This cannot be undone."}
            confirmLabel="Delete team"
            onConfirm={async () => {
              if (!deleting) return;
              await remove.mutateAsync(deleting.id);
              toast.success("Team deleted");
            }}
          />
        </>
      ) : null}
    </div>
  );
}
