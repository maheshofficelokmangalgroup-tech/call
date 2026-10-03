import { Link } from "react-router";

import type { CallRowModel } from "@/lib/callModels";
import { formatDuration, formatPhone } from "@/lib/format";
import { dispositionLook, dispositionName } from "@/lib/status";
import { AMBER_TEXT, GREY_SOFT, colors } from "@/lib/theme";
import { formatClock, formatDayLabel } from "@/lib/time";

import { Tag } from "./Chip";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

function tone(row: CallRowModel): { icon: IconName; color: string; bg: string } {
  if (row.needsOutcome) return { icon: "alert", color: AMBER_TEXT, bg: colors.orangeSoft };
  if (row.status === "failed") return { icon: "phone-off", color: colors.muted, bg: GREY_SOFT };
  if (row.status === "completed" || row.status === "connected") return { icon: "phone-out", color: colors.green, bg: colors.greenSoft };
  return { icon: "phone-missed", color: colors.red, bg: colors.redSoft };
}

interface Props {
  row: CallRowModel;
  /** show the contact's name (history) or just the time (contact page) */
  showName?: boolean;
}

export function CallRow({ row, showName = true }: Props) {
  const look = tone(row);
  const disposition = dispositionLook(row.disposition);
  const label = dispositionName(row.disposition, row.dispositionLabel) ?? (row.disposition ? row.disposition.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null);
  const answered = row.status === "completed" || row.status === "connected";
  return (
    <Link to={`/call/${row.serverId}`} className="row-card row-link call-row" data-testid="call-row">
      <span className="call-icon" style={{ backgroundColor: look.bg }}>
        <Icon name={look.icon} size={20} color={look.color} />
      </span>
      <span className="row-body">
        <Text variant="h3" lines={1}>
          {showName ? row.name : `${formatDayLabel(row.startedAt)}, ${formatClock(row.startedAt)}`}
        </Text>
        <Text variant="small" color="muted" lines={2}>
          {showName ? `${formatDayLabel(row.startedAt)}, ${formatClock(row.startedAt)}  •  ` : ""}
          {answered ? formatDuration(row.durationSec) : row.status === "failed" ? "Not placed" : "Not answered"}
          {showName && row.name !== row.phone ? `  •  ${formatPhone(row.phone)}` : ""}
        </Text>
      </span>
      <span className="call-right">
        {row.needsOutcome ? (
          <Tag label="Needs outcome" color={AMBER_TEXT} background={colors.orangeSoft} />
        ) : label ? (
          <Tag label={label} color={disposition?.tone ?? colors.muted} background={disposition?.soft ?? GREY_SOFT} />
        ) : null}
        <span className="call-meta">
          {row.recording === "available" ? <Icon name="headphones" size={14} color={colors.green} /> : null}
          {row.recording === "pending" || row.recording === "uploading" ? <Icon name="refresh" size={14} color={colors.blue} /> : null}
        </span>
      </span>
    </Link>
  );
}
