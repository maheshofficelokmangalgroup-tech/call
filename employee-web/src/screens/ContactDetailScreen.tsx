import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { CallRow } from "@/components/CallRow";
import { CallbackPicker } from "@/components/CallbackPicker";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatPhone } from "@/lib/format";
import { newId } from "@/lib/ids";
import { invalidateAfterCall, qk, useCallbacks, useContact, useContactCalls, useContactNotes } from "@/lib/queries";
import { AMBER_TEXT, colors } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { describeCallbackTime, formatDateTime, parseIso, timeAgo } from "@/lib/time";
import type { Callback } from "@/lib/types";
import { useCallAction } from "@/lib/useCallAction";
import { useGoBack } from "@/lib/useGoBack";

const HERO_PX = 240;

export function ContactDetailScreen() {
  const id = Number(useParams().id);
  const goBack = useGoBack();
  const call = useCallAction();
  const queryClient = useQueryClient();
  const detail = useContact(id);
  const notes = useContactNotes(id);
  const history = useContactCalls(id);
  const callbacks = useCallbacks();

  const [noteSheet, setNoteSheet] = useState(false);
  const [callbackSheet, setCallbackSheet] = useState(false);

  // the compact title bar and the sticky call button appear (at once, without animating) when the page is scrolled
  const [scrolled, setScrolled] = useState(0);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!Number.isFinite(id)) return <EmptyState icon="search" title="Contact not found" actionLabel="Go back" onAction={goBack} />;
  const contact = detail.data;
  if (!contact) {
    if (detail.isError) {
      return <EmptyState icon="alert" title="Could not open this contact" message={errorMessage(detail.error)} actionLabel="Go back" onAction={goBack} tone={colors.red} toneSoft={colors.redSoft} />;
    }
    return (
      <div className="page">
        <Skeleton height={200} rounded={24} />
        <Skeleton height={90} rounded={18} style={{ marginTop: 14 }} />
      </div>
    );
  }

  const blocked = contact.status === "do_not_contact";
  const pendingCallback = (callbacks.data ?? []).find((c) => c.contact_id === id && c.status === "pending") ?? null;
  const last = parseIso(contact.last_called_at);
  const showCompact = scrolled > HERO_PX * 0.6;
  const showStickyCall = scrolled > HERO_PX + 20 && !blocked;

  const startCall = () => void call({ contactId: contact.id, contactName: contact.name, phone: contact.phone, campaignId: contact.campaigns?.[0]?.id ?? null });

  const saveNote = async (text: string) => {
    try {
      await api.addNote(id, text, newId());
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey: qk.contactNotes(id) });
    setNoteSheet(false);
    toast.success("Note saved");
  };

  const saveCallback = async (when: number, note: string | null) => {
    const scheduled_at = new Date(when).toISOString();
    try {
      if (pendingCallback) await api.updateCallback(pendingCallback.id, { scheduled_at, note });
      else await api.createCallback({ contact_id: id, scheduled_at, note, client_ref: newId() });
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
    invalidateAfterCall(queryClient, id);
    setCallbackSheet(false);
    toast.success(`Callback set for ${formatDateTime(when)}`);
  };

  return (
    <div className="contact-page">
      <div className="topbar">
        <button type="button" className="icon-btn raised" onClick={goBack} aria-label="Go back" data-testid="contact-back">
          <Icon name="arrow-left" size={22} />
        </button>
        {showCompact ? (
          <Text variant="h2" lines={1} className="topbar-name">
            {contact.name}
          </Text>
        ) : null}
      </div>

      <section className="contact-hero" style={{ minHeight: HERO_PX }}>
        <span className="bubble bubble-a" />
        <span className="bubble bubble-b" />
        <Avatar name={contact.name} size={68} />
        <Text variant="h1" color={colors.white} align="center" lines={2} className="contact-name" as="h1">
          {contact.name}
        </Text>
        <Text variant="h3" color="rgba(255,255,255,0.9)" className="selectable">
          {formatPhone(contact.phone)}
        </Text>
        <div className="hero-actions">
          {blocked ? (
            <span className="call-disc call-disc-blocked" aria-label="Calling is blocked">
              <Icon name="shield" size={24} color={colors.white} />
            </span>
          ) : (
            <button type="button" className="call-disc" onClick={startCall} aria-label={`Call ${contact.name}`} data-testid="contact-call">
              <Icon name="phone" size={26} color={colors.ink} />
            </button>
          )}
          <ActionButton icon="note" label="Note" onClick={() => setNoteSheet(true)} />
          <ActionButton icon="calendar-clock" label="Reschedule" onClick={() => setCallbackSheet(true)} disabled={blocked} />
        </div>
      </section>

      <div className="contact-body">
        {blocked ? (
          <div className="blocked-card">
            <Icon name="shield" size={22} color={colors.red} />
            <Text variant="bodyMedium" color={colors.red}>
              This contact asked not to be called. Calling is blocked.
            </Text>
          </div>
        ) : null}

        {pendingCallback ? <CallbackCard callback={pendingCallback} onReschedule={() => setCallbackSheet(true)} /> : null}

        <Card className="stack">
          <Text variant="h2" className="card-title">
            Details
          </Text>
          <DetailLine icon="pin" label="Location" value={contact.location} />
          <DetailLine icon="phone-out" label="Calls so far" value={String(contact.call_count)} />
          <DetailLine icon="clock" label="Last called" value={last ? timeAgo(last) : "Never"} />
        </Card>

        <Card className="stack">
          <div className="card-head">
            <Text variant="h2">Notes</Text>
            <button type="button" className="link-btn" onClick={() => setNoteSheet(true)} data-testid="add-note">
              + Add note
            </button>
          </div>
          {(notes.data ?? []).length === 0 ? (
            <Text variant="small" color="muted">
              No notes yet. Add what matters for the next call.
            </Text>
          ) : (
            (notes.data ?? []).slice(0, 5).map((n) => (
              <div key={n.id} className="note">
                <Text variant="body" className="note-body">
                  {n.body}
                </Text>
                <Text variant="caption" color="faint">
                  {n.author_name ?? "You"} • {timeAgo(parseIso(n.created_at) ?? Date.now())}
                </Text>
              </div>
            ))
          )}
        </Card>

        <Text variant="h2" className="section-title">
          Call history
        </Text>
        {history.isPending ? (
          <Skeleton height={56} rounded={18} />
        ) : (history.data ?? []).length === 0 ? (
          <Text variant="small" color="muted">
            No calls yet.
          </Text>
        ) : (
          (history.data ?? []).slice(0, 15).map((row) => <CallRow key={row.key} row={row} showName={false} />)
        )}
      </div>

      {showStickyCall ? (
        <div className="sticky-call">
          <Button title={`Call ${contact.name.split(" ")[0]}`} icon="phone" onClick={startCall} />
        </div>
      ) : null}

      <NoteSheet open={noteSheet} onClose={() => setNoteSheet(false)} onSave={saveNote} />
      <CallbackSheet
        open={callbackSheet}
        initial={pendingCallback ? parseIso(pendingCallback.scheduled_at) : null}
        rescheduling={Boolean(pendingCallback)}
        onClose={() => setCallbackSheet(false)}
        onSave={saveCallback}
      />
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="hero-action" onClick={onClick} disabled={disabled}>
      <span className="hero-action-disc">
        <Icon name={icon} size={20} color={colors.white} />
      </span>
      <Text variant="caption" color="rgba(255,255,255,0.9)" as="span">
        {label}
      </Text>
    </button>
  );
}

function DetailLine({ icon, label, value }: { icon: IconName; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="line">
      <span className="line-icon">
        <Icon name={icon} size={16} color={colors.muted} />
      </span>
      <Text variant="small" color="muted" className="line-label">
        {label}
      </Text>
      <Text variant="bodyMedium" className="line-value">
        {value}
      </Text>
    </div>
  );
}

function CallbackCard({ callback, onReschedule }: { callback: Callback; onReschedule: () => void }) {
  const when = parseIso(callback.scheduled_at) ?? Date.now();
  const overdue = when <= Date.now();
  return (
    <div className={["callback-card", overdue ? "callback-overdue" : ""].filter(Boolean).join(" ")} data-testid="callback-card">
      <div className="callback-head">
        <Icon name="calendar-clock" size={22} color={overdue ? colors.red : AMBER_TEXT} />
        <div>
          <Text variant="h3" color={overdue ? colors.red : "#7C2D12"}>
            Callback {describeCallbackTime(when)}
          </Text>
          <Text variant="small" color="muted">
            {formatDateTime(when)}
            {callback.note ? `  •  ${callback.note}` : ""}
          </Text>
        </div>
      </div>
      <Button title="Reschedule" size="sm" variant="outline" onClick={onReschedule} className="callback-btn" />
    </div>
  );
}

function NoteSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Add a note">
      <TextField value={text} onChange={setText} placeholder="What should you remember for next time?" multiline rows={5} autoFocus maxLength={2000} testId="note-text" />
      <Button
        title="Save note"
        icon="check"
        loading={saving}
        disabled={!text.trim()}
        testId="note-save"
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(text.trim());
          } catch {
            /* the message is already shown; the sheet stays open */
          } finally {
            setSaving(false);
          }
        }}
      />
    </Sheet>
  );
}

function CallbackSheet({
  open,
  onClose,
  onSave,
  initial,
  rescheduling,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (when: number, note: string | null) => Promise<void>;
  initial: number | null;
  rescheduling: boolean;
}) {
  const [when, setWhen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setWhen(initial);
      setNote("");
    }
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} title={rescheduling ? "Reschedule callback" : "Schedule a callback"}>
      <CallbackPicker value={when} onChange={setWhen} />
      <div className="gap" />
      <TextField value={note} onChange={setNote} placeholder="Note (optional)" maxLength={500} />
      <Button
        title={rescheduling ? "Update callback" : "Set callback"}
        icon="calendar-clock"
        disabled={when === null}
        loading={saving}
        testId="callback-save"
        onClick={async () => {
          if (when === null) return;
          setSaving(true);
          try {
            await onSave(when, note.trim() || null);
          } catch {
            /* the message is already shown; the sheet stays open */
          } finally {
            setSaving(false);
          }
        }}
      />
    </Sheet>
  );
}
