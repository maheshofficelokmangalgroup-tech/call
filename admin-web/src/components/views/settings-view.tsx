"use client";

import { ArrowRightLeft, Headphones, Repeat2, ShieldAlert, Target, Copy as CopyIcon } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { useMe, useSettings, useUpdateSetting } from "@/lib/queries";
import type { Settings } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const RETRY_KEYS = [
  { key: "NO_ANSWER", label: "Nobody picked up", hint: "The phone rang but nobody answered." },
  { key: "BUSY", label: "Line was busy", hint: "The number was engaged." },
  { key: "SWITCHED_OFF", label: "Phone switched off", hint: "The number was not reachable." },
] as const;

type RetryRules = Record<string, { delay_minutes: number; max_attempts: number }>;

function describeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "-";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d ? `${d} day${d > 1 ? "s" : ""}` : "", h ? `${h} hour${h > 1 ? "s" : ""}` : "", m ? `${m} min` : ""].filter(Boolean);
  return parts.join(" ");
}

function Section({ icon: Icon, title, description, children, footer, index = 0, testId }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; children: React.ReactNode; footer: React.ReactNode; index?: number; testId?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" data-testid={testId}>
      <header className="flex items-start gap-4 border-b border-line px-6 py-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-extrabold tracking-tight text-ink">{title}</h2>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
      </header>
      <div className="space-y-5 px-6 py-5">{children}</div>
      <footer className="flex items-center justify-end gap-3 border-t border-line bg-surface-2 px-6 py-3.5">{footer}</footer>
    </motion.section>
  );
}

function SaveBar({ dirty, busy, onSave, onReset, updatedAt }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void; updatedAt?: string | null }) {
  return (
    <>
      {!dirty && updatedAt ? <span className="mr-auto text-xs text-muted">Last changed {formatDate(updatedAt)}</span> : null}
      {dirty ? (
        <Button variant="ghost" size="sm" onClick={onReset} disabled={busy}>
          Undo
        </Button>
      ) : null}
      <Button size="sm" onClick={onSave} disabled={!dirty} loading={busy} data-testid="save-setting">
        Save
      </Button>
    </>
  );
}

/** One settings card: what is being edited is a draft kept apart from the saved value, so "unsaved changes" is simply "there is a draft". */
function useSection<T>(source: T, key: string) {
  const update = useUpdateSetting();
  const [draft, setDraft] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const value = draft ?? source;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(source);
  const setValue = (next: T | ((current: T) => T)) => setDraft((prev) => (typeof next === "function" ? (next as (current: T) => T)(prev ?? source) : next));

  async function save(payload: unknown, successText: string) {
    setError(null);
    try {
      await update.mutateAsync({ key, value: payload });
      setDraft(null);
      toast.success(successText);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return { value, setValue, dirty, busy: update.isPending, error, save, reset: () => setDraft(null) };
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
      {message}
    </p>
  ) : null;
}

function RecordingSection({ settings, index }: { settings: Settings; index: number }) {
  const source = React.useMemo(() => ({ enabled: Boolean(settings.recording.enabled), notice_text: String(settings.recording.notice_text ?? "") }), [settings.recording]);
  const s = useSection(source, "recording");
  const tooShort = s.value.notice_text.trim().length < 10;
  const updated = settings.items.find((i) => i.key === "recording")?.updated_at;
  return (
    <Section
      index={index}
      icon={Headphones}
      title="Call recording"
      description="Turn recording on or off for everyone, and set the notice employees see on the phone."
      testId="setting-recording"
      footer={<SaveBar dirty={s.dirty && !tooShort} busy={s.busy} onSave={() => void s.save({ enabled: s.value.enabled, notice_text: s.value.notice_text.trim() }, "Recording settings saved")} onReset={s.reset} updatedAt={updated} />}
    >
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line p-4">
        <span>
          <span className="block text-sm font-bold text-ink">Record calls</span>
          <span className="block text-xs text-muted">When off, phones do not record and nothing is uploaded.</span>
        </span>
        <Switch checked={s.value.enabled} onCheckedChange={(enabled) => s.setValue((v) => ({ ...v, enabled }))} data-testid="recording-switch" aria-label="Record calls" />
      </label>
      <Field label="Notice shown to employees" htmlFor="st-notice" error={s.dirty && tooShort ? "Write at least 10 characters." : undefined} hint="Employees accept this the first time they use the app. Say plainly that calls are recorded and why.">
        <Textarea id="st-notice" rows={4} maxLength={1000} value={s.value.notice_text} onChange={(e) => s.setValue((v) => ({ ...v, notice_text: e.target.value }))} data-testid="recording-notice" />
      </Field>
      <ErrorLine message={s.error} />
    </Section>
  );
}

function RetrySection({ settings, index }: { settings: Settings; index: number }) {
  const source = React.useMemo<RetryRules>(() => {
    const rules = settings.retry_rules as RetryRules;
    return Object.fromEntries(RETRY_KEYS.map(({ key }) => [key, { delay_minutes: Number(rules[key]?.delay_minutes ?? 120), max_attempts: Number(rules[key]?.max_attempts ?? 3) }]));
  }, [settings.retry_rules]);
  const s = useSection(source, "retry_rules");
  const invalid = RETRY_KEYS.some(({ key }) => {
    const r = s.value[key]!;
    return !(r.delay_minutes >= 1 && r.delay_minutes <= 10080) || !(r.max_attempts >= 1 && r.max_attempts <= 20) || !Number.isInteger(r.delay_minutes) || !Number.isInteger(r.max_attempts);
  });
  const set = (key: string, field: "delay_minutes" | "max_attempts", raw: string) => s.setValue((v) => ({ ...v, [key]: { ...v[key]!, [field]: raw === "" ? 0 : Number(raw) } }));
  const updated = settings.items.find((i) => i.key === "retry_rules")?.updated_at;
  return (
    <Section
      index={index}
      icon={Repeat2}
      title="Calling again"
      description="When a call is not answered, the contact comes back to the employee's list after a waiting time, up to a limit."
      testId="setting-retry"
      footer={<SaveBar dirty={s.dirty && !invalid} busy={s.busy} onSave={() => void s.save(s.value, "Retry rules saved")} onReset={s.reset} updatedAt={updated} />}
    >
      <div className="space-y-3">
        {RETRY_KEYS.map(({ key, label, hint }) => (
          <div key={key} className="grid grid-cols-1 items-end gap-3 rounded-2xl border border-line p-4 sm:grid-cols-[1fr_150px_150px]">
            <div>
              <p className="text-sm font-bold text-ink">{label}</p>
              <p className="text-xs text-muted">{hint}</p>
            </div>
            <Field label="Wait (minutes)" htmlFor={`rt-${key}-delay`} hint={describeMinutes(s.value[key]!.delay_minutes)}>
              <Input id={`rt-${key}-delay`} inputMode="numeric" value={s.value[key]!.delay_minutes || ""} onChange={(e) => set(key, "delay_minutes", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Tries at most" htmlFor={`rt-${key}-max`} hint="then marked unreachable">
              <Input id={`rt-${key}-max`} inputMode="numeric" value={s.value[key]!.max_attempts || ""} onChange={(e) => set(key, "max_attempts", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        ))}
      </div>
      {invalid ? <p className="text-xs font-medium text-danger">Waiting time must be 1 to 10080 minutes (one week) and tries 1 to 20.</p> : null}
      <ErrorLine message={s.error} />
    </Section>
  );
}

function TargetSection({ settings, index }: { settings: Settings; index: number }) {
  const s = useSection(settings.default_daily_target, "default_daily_target");
  const valid = Number.isInteger(s.value) && s.value >= 0 && s.value <= 2000;
  const updated = settings.items.find((i) => i.key === "default_daily_target")?.updated_at;
  return (
    <Section
      index={index}
      icon={Target}
      title="Daily call target"
      description="The number of calls suggested for a new employee. You can still set a different target for each person."
      testId="setting-target"
      footer={<SaveBar dirty={s.dirty && valid} busy={s.busy} onSave={() => void s.save(s.value, "Default target saved")} onReset={s.reset} updatedAt={updated} />}
    >
      <Field label="Calls per day" htmlFor="st-target" error={valid ? undefined : "Enter a whole number from 0 to 2000."} hint="0 means no target.">
        <Input id="st-target" inputMode="numeric" className="max-w-40" value={Number.isNaN(s.value) ? "" : String(s.value)} onChange={(e) => s.setValue(e.target.value === "" ? NaN : Number(e.target.value.replace(/\D/g, "")))} aria-invalid={!valid} />
      </Field>
      <ErrorLine message={s.error} />
    </Section>
  );
}

function DuplicateSection({ settings, index }: { settings: Settings; index: number }) {
  const s = useSection(settings.duplicate_policy, "duplicate_policy");
  const updated = settings.items.find((i) => i.key === "duplicate_policy")?.updated_at;
  return (
    <Section
      index={index}
      icon={CopyIcon}
      title="Duplicate contacts in an import"
      description="What happens when a contact sheet has a phone number that already exists."
      testId="setting-duplicates"
      footer={<SaveBar dirty={s.dirty} busy={s.busy} onSave={() => void s.save(s.value, "Duplicate policy saved")} onReset={s.reset} updatedAt={updated} />}
    >
      <Segmented
        name="dup-policy"
        value={s.value}
        onChange={(v) => s.setValue(v)}
        aria-label="Duplicate policy"
        options={[
          { value: "skip", label: "Skip the duplicate" },
          { value: "update", label: "Update the existing contact" },
        ]}
      />
      <p className="text-sm text-muted">{s.value === "skip" ? "The existing contact stays exactly as it is, and the row in the sheet is ignored." : "The existing contact is changed to match the sheet (name, location, tags and so on)."}</p>
      <ErrorLine message={s.error} />
    </Section>
  );
}

function ActivitySection({ settings, index }: { settings: Settings; index: number }) {
  const s = useSection(settings.inactive_after_days, "inactive_after_days");
  const update = useUpdateSetting();
  const valid = Number.isInteger(s.value) && s.value >= 1 && s.value <= 90;
  const updated = settings.items.find((i) => i.key === "inactive_after_days")?.updated_at;
  const [switchError, setSwitchError] = React.useState<string | null>(null);

  // the switch is saved the moment it is flipped (it is a yes / no, not something to type); the number is saved with the button
  async function setAuto(auto: boolean) {
    setSwitchError(null);
    try {
      await update.mutateAsync({ key: "auto_rebalance", value: auto });
      toast.success(auto ? "Automatic sharing is on" : "Automatic sharing is off");
    } catch (e) {
      setSwitchError(errorMessage(e));
    }
  }

  return (
    <Section
      index={index}
      icon={ArrowRightLeft}
      title="Who counts as working"
      description="An employee who has not been seen for this many days gets no new contacts from a sheet, and the contacts they did not get to are given to the people who are working."
      testId="setting-activity"
      footer={<SaveBar dirty={s.dirty && valid} busy={s.busy} onSave={() => void s.save(s.value, "Saved")} onReset={s.reset} updatedAt={updated} />}
    >
      <Field label="Not seen for (days)" htmlFor="st-inactive" error={valid ? undefined : "Enter a whole number from 1 to 90."} hint="Seen means: signed in, the app was open, or the phone reported in. 2 is a good start; use more if people have days off.">
        <Input id="st-inactive" inputMode="numeric" className="max-w-40" value={Number.isNaN(s.value) ? "" : String(s.value)} onChange={(e) => s.setValue(e.target.value === "" ? NaN : Number(e.target.value.replace(/\D/g, "")))} aria-invalid={!valid} data-testid="inactive-days" />
      </Field>
      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line p-4">
        <span>
          <span className="block text-sm font-bold text-ink">Share their contacts automatically</span>
          <span className="block text-xs text-muted">Every ten minutes the server looks for employees who stopped working and gives the contacts nobody has called yet - not the ones with a promised callback - to the people who are working. Every move is in the history of the Work sharing page.</span>
        </span>
        <Switch checked={settings.auto_rebalance} onCheckedChange={(auto) => void setAuto(auto)} disabled={update.isPending} data-testid="auto-rebalance-switch" aria-label="Share their contacts automatically" />
      </label>
      <ErrorLine message={s.error ?? switchError} />
    </Section>
  );
}

export function SettingsView() {
  const me = useMe();
  const settings = useSettings();

  if (me.data && me.data.employee.role !== "admin") {
    return (
      <div className="rounded-2xl border border-line bg-surface shadow-card">
        <EmptyState icon={ShieldAlert} title="Only administrators can change settings" description="Ask an administrator if something needs to be different." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="System" title="Settings" description="Rules that apply to the whole organisation. Every change is written to the audit log." />
      {settings.isError ? (
        <div className="rounded-2xl border border-line bg-surface shadow-card">
          <ErrorState message="The settings could not be loaded." onRetry={() => settings.refetch()} />
        </div>
      ) : !settings.data ? (
        <div className="max-w-3xl space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-56 rounded-2xl")} />
          ))}
        </div>
      ) : (
        <div className="max-w-3xl space-y-5">
          <RecordingSection settings={settings.data} index={0} />
          <RetrySection settings={settings.data} index={1} />
          <TargetSection settings={settings.data} index={2} />
          <DuplicateSection settings={settings.data} index={3} />
          <ActivitySection settings={settings.data} index={4} />
        </div>
      )}
    </div>
  );
}
