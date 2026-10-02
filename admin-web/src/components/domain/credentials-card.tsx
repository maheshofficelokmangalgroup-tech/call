"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, MessageCircle, ShieldAlert } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn, copyText } from "@/lib/utils";

export interface Credentials {
  name: string;
  employeeCode: string;
  email: string;
  /** the password to hand over; null when the administrator chose it themselves and it is not echoed back */
  password: string | null;
  phone?: string | null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? "";

/** The message an administrator sends to the employee: ID, e-mail, password and (when configured) where to get the app. */
export function credentialsMessage(c: Credentials): string {
  return [
    `Hello ${c.name},`,
    "",
    "Your Employee Calling login:",
    `Employee ID: ${c.employeeCode}`,
    `Email: ${c.email}`,
    c.password ? `Password: ${c.password}` : "Password: (the one your administrator gave you)",
    APP_URL ? `\nInstall the app: ${APP_URL}` : "",
    "",
    "Please change your password after you sign in for the first time.",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

/** WhatsApp link with the message filled in; with a phone number it opens that person's chat. */
export function whatsappLink(c: Credentials): string {
  const digits = (c.phone ?? "").replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(credentialsMessage(c))}`;
}

function Row({ label, value, mono = true, secret = false }: { label: string; value: string; mono?: boolean; secret?: boolean }) {
  const [shown, setShown] = React.useState(!secret);
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className={cn("truncate text-[15px] font-bold text-ink", mono && "font-mono tracking-wide")} data-testid={`cred-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {shown ? value : "•".repeat(Math.min(value.length, 14))}
        </p>
      </div>
      {secret ? (
        <button type="button" onClick={() => setShown((s) => !s)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink" aria-label={shown ? `Hide ${label}` : `Show ${label}`}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      ) : null}
      <button type="button" onClick={copy} className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink" aria-label={`Copy ${label}`}>
        {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Login details of one employee, with one-tap copy and WhatsApp. Shown once, right after the account (or a new password) is created. */
export function CredentialsCard({ credentials, title = "Login details", className }: { credentials: Credentials; title?: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copyAll() {
    if (await copyText(credentialsMessage(credentials))) {
      setCopied(true);
      toast.success("Login details copied");
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast.error("Could not copy automatically.");
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className={className} data-testid="credentials-card">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <KeyRound className="size-[18px]" />
        </span>
        <div>
          <p className="text-sm font-extrabold text-ink">{title}</p>
          <p className="text-xs text-muted">{credentials.name}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Row label="Employee ID" value={credentials.employeeCode} />
        <Row label="Email" value={credentials.email} mono={false} />
        {credentials.password ? <Row label="Password" value={credentials.password} secret /> : <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-muted">The password is the one you typed. It is not shown again.</p>}
      </div>

      {credentials.password ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-xs font-medium text-warn">
          <ShieldAlert className="mt-px size-4 shrink-0" />
          <span>This password is shown only now. Copy it and send it to the employee - you can always create a new one later from the employee page.</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copyAll} data-testid="copy-credentials">
          {copied ? <Check className="size-4 text-brand" /> : <Copy className="size-4" />} Copy all
        </Button>
        <Button asChild variant="soft" size="sm">
          <a href={whatsappLink(credentials)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" /> Send on WhatsApp
          </a>
        </Button>
      </div>
    </motion.div>
  );
}
