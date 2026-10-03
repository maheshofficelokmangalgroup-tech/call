import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { CallbackPicker } from "@/components/CallbackPicker";
import { Tag } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Sheet } from "@/components/Sheet";
import { RowSkeleton } from "@/components/Skeleton";
import { SyncBanner } from "@/components/SyncBanner";
import { Text } from "@/components/Text";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatPhone } from "@/lib/format";
import { invalidateAfterCall, isOffline, useCallbacks } from "@/lib/queries";
import { AMBER_TEXT, colors } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { describeCallbackTime, formatDateTime, isSameDay, parseIso, startOfDay } from "@/lib/time";
import type { Callback } from "@/lib/types";
import { useCallAction } from "@/lib/useCallAction";

type Bucket = "Overdue" | "Today" | "Later";

function bucket(cb: Callback, now: number): Bucket {
  const at = parseIso(cb.scheduled_at) ?? now;
  if (at <= now) return "Overdue";
  if (isSameDay(at, now) || at < startOfDay(now) + 86_400_000) return "Today";
  return "Later";
}

export function CallbacksScreen() {
  const callbacks = useCallbacks();
  const queryClient = useQueryClient();
  const call = useCallAction();
  const [editing, setEditing] = useState<Callback | null>(null);
  const [when, setWhen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const sections = useMemo(() => {
    const now = Date.now();
    const order: Bucket[] = ["Overdue", "Today", "Later"];
    const items = [...(callbacks.data ?? [])].sort((a, b) => (parseIso(a.scheduled_at) ?? 0) - (parseIso(b.scheduled_at) ?? 0));
    return order.map((title) => ({ title, data: items.filter((c) => bucket(c, now) === title) })).filter((s) => s.data.length > 0);
  }, [callbacks.data]);

  const finish = async (cb: Callback, status: "done" | "cancelled") => {
    try {
      await api.updateCallback(cb.id, { status });
      invalidateAfterCall(queryClient, cb.contact_id);
      toast.success(status === "done" ? "Marked as done" : "Callback cancelled");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const reschedule = async () => {
    if (!editing || when === null) return;
    setSaving(true);
    try {
      await api.updateCallback(editing.id, { scheduled_at: new Date(when).toISOString() });
      invalidateAfterCall(queryClient, editing.contact_id);
      toast.success(`Callback moved to ${formatDateTime(when)}`);
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <ScreenHeader title="Callbacks" subtitle={`${callbacks.data?.length ?? 0} scheduled`} back />
      <SyncBanner offline={isOffline(callbacks)} onRetry={() => void callbacks.refetch()} />

      {callbacks.isPending ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : sections.length === 0 ? (
        <EmptyState icon="calendar-clock" title="No callbacks" message="When a contact asks you to call back, schedule it from the contact's page and it will show up here." />
      ) : (
        sections.map((section) => (
          <section key={section.title}>
            <Text variant="smallMedium" color={section.title === "Overdue" ? colors.red : "muted"} className="section-label" as="h2">
              {section.title.toUpperCase()}
            </Text>
            {section.data.map((item) => {
              const at = parseIso(item.scheduled_at) ?? Date.now();
              const overdue = at <= Date.now();
              const contact = item.contact;
              return (
                <div key={item.id} className="cb-card" data-testid="callback-item">
                  <Link to={`/contact/${item.contact_id}`} className="cb-top">
                    <Avatar name={contact?.name ?? "Contact"} size={46} />
                    <span className="row-body">
                      <Text variant="h3" lines={1}>
                        {contact?.name ?? `Contact #${item.contact_id}`}
                      </Text>
                      <Text variant="small" color="muted" lines={1}>
                        {contact ? formatPhone(contact.phone) : ""}
                      </Text>
                      <span className="cb-tags">
                        <Tag label={describeCallbackTime(at)} icon="calendar-clock" color={overdue ? colors.red : AMBER_TEXT} background={overdue ? colors.redSoft : colors.orangeSoft} />
                        <Text variant="caption" color="muted" as="span">
                          {formatDateTime(at)}
                        </Text>
                      </span>
                      {item.note ? (
                        <Text variant="small" color="inkSoft" lines={2} className="cb-note">
                          {item.note}
                        </Text>
                      ) : null}
                    </span>
                  </Link>
                  <div className="cb-actions">
                    <Button title="Call" icon="phone" size="sm" disabled={!contact} onClick={() => contact && void call({ contactId: contact.id, contactName: contact.name, phone: contact.phone })} className="grow" />
                    <Button
                      title="Reschedule"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(item);
                        setWhen(at);
                      }}
                      className="grow"
                    />
                    <button type="button" className="icon-btn icon-btn-sm flat" onClick={() => void finish(item, "done")} aria-label="Mark as done">
                      <Icon name="check" size={20} color={colors.green} />
                    </button>
                    <button type="button" className="icon-btn icon-btn-sm flat" onClick={() => void finish(item, "cancelled")} aria-label="Cancel callback">
                      <Icon name="x" size={20} color={colors.red} />
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Reschedule callback">
        <CallbackPicker value={when} onChange={setWhen} />
        <div className="gap" />
        <Button title="Update callback" icon="calendar-clock" disabled={when === null} loading={saving} onClick={() => void reschedule()} testId="callback-update" />
      </Sheet>
    </div>
  );
}
