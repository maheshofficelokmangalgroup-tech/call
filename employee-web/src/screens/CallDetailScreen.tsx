import { useNavigate, useParams } from "react-router";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Tag } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { RecordingPlayer } from "@/components/RecordingPlayer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { errorMessage } from "@/lib/api";
import { formatDuration, formatPhone } from "@/lib/format";
import { useCall } from "@/lib/queries";
import { CALL_STATUS_LABEL, dispositionLook, dispositionName } from "@/lib/status";
import { GREY_SOFT, colors } from "@/lib/theme";
import { formatClock, formatDayLabel, parseIso } from "@/lib/time";

const EVENT_LABEL: Record<string, { label: string; icon: IconName }> = {
  initiated: { label: "Call started", icon: "phone-out" },
  dialing: { label: "Dialing", icon: "phone-out" },
  ringing: { label: "Ringing", icon: "phone-in" },
  connected: { label: "Answered", icon: "phone-call" },
  ended: { label: "Call ended", icon: "phone-off" },
  failed: { label: "Call failed", icon: "alert" },
  disposition: { label: "Outcome recorded", icon: "check-circle" },
  reconciled: { label: "Synced with call log", icon: "refresh" },
};

export function CallDetailScreen() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const query = useCall(id);
  const call = query.data;

  if (!Number.isFinite(id)) return <EmptyState icon="search" title="Call not found" />;
  if (!call) {
    return (
      <div className="page">
        <ScreenHeader title="Call details" back />
        {query.isError ? (
          <EmptyState icon="alert" title="Could not open this call" message={errorMessage(query.error)} actionLabel="Try again" onAction={() => void query.refetch()} tone={colors.red} toneSoft={colors.redSoft} />
        ) : (
          <Skeleton height={140} rounded={24} />
        )}
      </div>
    );
  }

  const name = call.contact_name ?? call.phone_number;
  const startedAt = parseIso(call.started_at) ?? 0;
  const connected = call.status === "completed" || call.status === "connected";
  const disposition = call.disposition?.code ?? null;
  const look = dispositionLook(disposition);
  // a call made from the web app says so in its timeline, and why it has no recording
  const fromWeb = call.events.some((e) => e.payload?.source === "web_app");
  const waiting = call.disposition === null && call.status !== "failed";

  return (
    <div className="page">
      <ScreenHeader title="Call details" back />

      <Card className="summary-card">
        <Avatar name={name} size={60} />
        <div className="summary-text">
          <Text variant="h1" lines={1}>
            {name}
          </Text>
          <Text variant="small" color="muted">
            {formatPhone(call.phone_number)}
          </Text>
          <div className="tags">
            <Tag label={CALL_STATUS_LABEL[call.status]} color={connected ? colors.greenDark : colors.red} background={connected ? colors.greenSoft : colors.redSoft} />
            {look && disposition ? <Tag label={dispositionName(disposition, call.disposition?.label) ?? disposition} color={look.tone} background={look.soft} /> : null}
            {waiting ? <Tag label="Needs outcome" color="#B45309" background={colors.orangeSoft} /> : null}
          </div>
        </div>
      </Card>

      {waiting ? <Button title="Record the outcome" icon="check" variant="accent" size="md" onClick={() => void navigate(`/outcome/${id}`)} className="detail-gap" testId="record-outcome" /> : null}

      <Card className="stats">
        <Stat label="When" value={`${formatDayLabel(startedAt)}, ${formatClock(startedAt)}`} />
        <span className="stats-divider" />
        <Stat label="Talk time" value={call.duration_seconds > 0 ? formatDuration(call.duration_seconds) : "-"} />
        <span className="stats-divider" />
        <Stat label="Attempt" value={`#${call.attempt_number}`} />
      </Card>

      {call.recording?.upload_status === "available" ? (
        <Card className="stack">
          <div className="card-head">
            <Text variant="h2">Recording</Text>
            <Tag label="Available" />
          </div>
          <RecordingPlayer recordingId={call.recording.id} />
        </Card>
      ) : fromWeb && call.status !== "failed" ? (
        <Card className="stack">
          <div className="card-head">
            <Text variant="h2">Recording</Text>
            <Tag label="Not recorded" color={colors.muted} background={GREY_SOFT} />
          </div>
          <Text variant="small" color="muted">
            This call was made from the web app. A browser cannot record a phone call - calls made in the phone app are recorded.
          </Text>
        </Card>
      ) : null}

      {call.notes.length > 0 ? (
        <Card className="stack">
          <Text variant="h2" className="card-title">
            Notes
          </Text>
          {call.notes.map((n) => (
            <div key={n.id} className="note">
              <Text variant="body" className="note-body">
                {n.body}
              </Text>
              <Text variant="caption" color="faint">
                {n.author_name ?? "You"}
              </Text>
            </div>
          ))}
        </Card>
      ) : null}

      {call.events.length > 0 ? (
        <Card className="stack">
          <Text variant="h2" className="card-title">
            Timeline
          </Text>
          {call.events.map((event, index) => {
            const meta = EVENT_LABEL[event.event_type] ?? { label: event.event_type, icon: "info" as IconName };
            const at = parseIso(event.occurred_at) ?? 0;
            return (
              <div key={event.id} className="event">
                <span className="event-rail">
                  <span className="event-dot">
                    <Icon name={meta.icon} size={14} color={colors.green} />
                  </span>
                  {index < call.events.length - 1 ? <span className="event-line" /> : null}
                </span>
                <span className="event-text">
                  <Text variant="bodyMedium">{meta.label}</Text>
                  <Text variant="caption" color="muted">
                    {formatClock(at)}
                  </Text>
                </span>
              </div>
            );
          })}
        </Card>
      ) : null}

      {call.contact_id ? <Button title="Open contact" variant="soft" icon="user" onClick={() => void navigate(`/contact/${call.contact_id}`)} className="detail-gap" /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="stat-cell">
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="h3" lines={1}>
        {value}
      </Text>
    </span>
  );
}
