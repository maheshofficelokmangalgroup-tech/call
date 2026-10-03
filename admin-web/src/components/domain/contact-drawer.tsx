"use client";

import { Hash, Mail, MapPin, Megaphone, Pencil, Phone, Send, StickyNote, Tag, Trash2, UserRound, UsersRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { OutcomeBadge, RecordingFlag, StatusBadge } from "@/components/domain/call-badges";
import { ContactFormDialog } from "@/components/domain/contact-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Textarea } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { errorMessage } from "@/lib/api";
import { useAddContactNote, useContact, useContactCalls, useContactMutations, useContactNotes, useMe } from "@/lib/queries";
import { PRIORITY_LABEL, contactStatus } from "@/lib/status";
import type { ContactDetail } from "@/lib/types";
import { formatDateTime, formatDuration, formatPhone, timeAgo } from "@/lib/utils";

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-soft">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function Notes({ contactId }: { contactId: number }) {
  const notes = useContactNotes(contactId);
  const add = useAddContactNote(contactId);
  const [text, setText] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await add.mutateAsync(text.trim());
      setText("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Write a note about this person..." aria-label="New note" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()} loading={add.isPending}>
            <Send className="size-3.5" /> Add note
          </Button>
        </div>
      </form>
      {notes.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (notes.data?.items.length ?? 0) === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.data?.items.map((n) => (
            <li key={n.id} className="rounded-2xl border border-line bg-accent-soft/50 p-3.5">
              <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
              <p className="mt-2 text-xs text-muted">
                {n.author_name ?? "Employee"} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function History({ contactId, onOpenCall }: { contactId: number; onOpenCall: (id: number) => void }) {
  const [page, setPage] = React.useState(1);
  const calls = useContactCalls(contactId, page);
  if (calls.isPending) return <Skeleton className="h-32 w-full" />;
  if ((calls.data?.items.length ?? 0) === 0) return <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">Nobody has called this person yet.</p>;
  return (
    <div className="space-y-2">
      {calls.data?.items.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpenCall(c.id)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/30">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-ink">{c.employee_name ?? "Employee"}</p>
            <p className="text-xs text-muted">{formatDateTime(c.started_at)}</p>
          </div>
          <StatusBadge status={c.status} />
          <OutcomeBadge outcome={c.disposition} />
          <span className="w-12 text-right text-sm font-bold text-ink tnum">{c.duration_seconds ? formatDuration(c.duration_seconds, { compact: true }) : ""}</span>
          <RecordingFlag call={c} />
        </button>
      ))}
      <Pagination page={page} pageSize={10} total={calls.data?.total ?? 0} onPage={setPage} />
    </div>
  );
}

function Details({ contact, canEdit, onEdit, onDelete, onOpenCall }: { contact: ContactDetail; canEdit: boolean; onEdit: () => void; onDelete: () => void; onOpenCall: (id: number) => void }) {
  const status = contactStatus(contact.status);
  const custom = Object.entries(contact.custom_fields ?? {}).filter(([, v]) => v !== null && v !== "");
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface-2 px-6 pb-5 pt-6 pr-16">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Badge tone="outline">{PRIORITY_LABEL[contact.priority] ?? "Normal"} priority</Badge>
        </div>
        <SheetTitle className="mt-3 truncate text-2xl">{contact.name}</SheetTitle>
        <SheetDescription className="mt-1 tnum">{formatPhone(contact.phone)}</SheetDescription>
        {canEdit ? (
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={onDelete}>
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <Section title="Details">
          <div className="space-y-2.5">
            {contact.relative_name ? <Fact icon={UsersRound}>Relative: {contact.relative_name}</Fact> : null}
            {contact.age || contact.gender ? <Fact icon={UserRound}>{[contact.age ? `${contact.age} years` : "", contact.gender === "M" ? "Male" : contact.gender === "F" ? "Female" : contact.gender === "O" ? "Other" : ""].filter(Boolean).join(" · ")}</Fact> : null}
            {contact.epic_no ? <Fact icon={Hash}>Voter card (EPIC) {contact.epic_no}</Fact> : null}
            {contact.email ? <Fact icon={Mail}>{contact.email}</Fact> : null}
            {contact.location ? <Fact icon={MapPin}>{contact.location}</Fact> : null}
            {contact.address || contact.pincode ? (
              <Fact icon={MapPin}>
                <span className="whitespace-normal">{[contact.address, contact.pincode].filter(Boolean).join(" - ")}</span>
              </Fact>
            ) : null}
            {contact.category ? <Fact icon={Tag}>{contact.category}</Fact> : null}
            <Fact icon={UserRound}>{contact.assigned_to ? `Assigned to ${contact.assigned_to.name}` : "Not assigned to anyone"}</Fact>
            {contact.campaigns.length > 0 ? <Fact icon={Megaphone}>{contact.campaigns.map((c) => c.name).join(", ")}</Fact> : null}
            {contact.last_called_at ? <Fact icon={Phone}>Last called {timeAgo(contact.last_called_at)}</Fact> : null}
          </div>
          {(contact.tags ?? []).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contact.tags!.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
          {custom.length > 0 ? (
            <dl className="mt-4 grid grid-cols-2 gap-2.5">
              {custom.map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface-2 p-3">
                  <dt className="text-xs font-semibold text-muted">{k}</dt>
                  <dd className="truncate text-sm font-semibold text-ink">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Section>

        <Section title="Numbers" aside={<span className="text-xs text-muted">{contact.phones.length} in total</span>}>
          <ul className="space-y-2" data-testid="contact-numbers">
            {contact.phones.map((p) => (
              <li key={p.phone} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3" data-testid="contact-number">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                  <Phone className="size-4" />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-sm font-semibold text-ink tnum">
                    {formatPhone(p.phone)}
                    {p.primary ? <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] font-bold text-ink-soft">Main</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {p.calls > 0 ? `${p.calls} call${p.calls === 1 ? "" : "s"}, ${p.answered} answered${p.last_called_at ? ` · last ${timeAgo(p.last_called_at)}` : ""}` : "not called yet"}
                  </p>
                </div>
                {p.invalid ? <Badge tone="danger">Wrong number</Badge> : p.phone === contact.call_phone && contact.phones.length > 1 ? <Badge tone="brand">Next to call</Badge> : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Calls to this person" aside={<span className="text-xs text-muted">{contact.call_count} in total</span>}>
          <History contactId={contact.id} onOpenCall={onOpenCall} />
        </Section>

        <Section title="Notes" aside={<StickyNote className="size-4 text-faint" />}>
          <Notes contactId={contact.id} />
        </Section>
      </div>
    </div>
  );
}

/** One contact in a panel beside the list: details, who owns it, every call made to it and the notes. */
export function ContactDrawer({ contactId, onClose, onOpenCall }: { contactId: number | null; onClose: () => void; onOpenCall: (id: number) => void }) {
  const [shown, setShown] = React.useState<number | null>(contactId);
  if (contactId !== null && contactId !== shown) setShown(contactId);

  const me = useMe();
  const isAdmin = me.data?.employee.role === "admin";
  const contact = useContact(shown);
  const { remove } = useContactMutations();
  const [edit, setEdit] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  return (
    <>
      <Sheet open={contactId !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent width="max-w-[560px]" aria-describedby={undefined} data-testid="contact-drawer">
          {contact.data ? (
            <Details contact={contact.data} canEdit={isAdmin} onEdit={() => setEdit(true)} onDelete={() => setConfirm(true)} onOpenCall={onOpenCall} />
          ) : contact.isError ? (
            <>
              <SheetTitle className="sr-only">Contact</SheetTitle>
              <ErrorState title="Could not open this contact" message="It may have been deleted, or you may not be allowed to see it." onRetry={() => contact.refetch()} className="my-auto" />
            </>
          ) : (
            <>
              <SheetTitle className="sr-only">Contact</SheetTitle>
              <div className="space-y-5 p-6">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-10 w-3/4" />
                <Skeleton className="h-40 w-full" />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {isAdmin ? (
        <>
          <ContactFormDialog open={edit} onOpenChange={setEdit} contact={contact.data} />
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            danger
            title={`Delete ${contact.data?.name ?? "this contact"}?`}
            description="The contact is removed from every list and campaign. Calls already made to this number stay in the call history."
            confirmLabel="Delete contact"
            onConfirm={async () => {
              if (!contact.data) return;
              await remove.mutateAsync(contact.data.id);
              toast.success("Contact deleted");
              onClose();
            }}
          />
        </>
      ) : null}
    </>
  );
}
