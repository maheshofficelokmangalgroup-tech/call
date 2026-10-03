import { Link } from "react-router";

import { formatPhone } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/status";
import { colors } from "@/lib/theme";
import { describeCallbackTime, parseIso, timeAgo } from "@/lib/time";
import type { QueueItem } from "@/lib/types";

import { Avatar } from "./Avatar";
import { Tag } from "./Chip";
import { Icon } from "./Icon";
import { Text } from "./Text";

function ReasonTag({ item }: { item: QueueItem }) {
  if (item.reason === "callback" && item.callback) {
    const when = parseIso(item.callback.scheduled_at) ?? Date.now();
    const overdue = item.callback.overdue;
    return (
      <Tag
        label={`Callback ${describeCallbackTime(when)}`}
        icon="calendar-clock"
        color={overdue ? colors.red : colors.orange}
        background={overdue ? colors.redSoft : colors.orangeSoft}
      />
    );
  }
  if (item.reason === "retry") return <Tag label={`Attempt ${item.attempts + 1}`} icon="refresh" color={colors.blue} background={colors.blueSoft} />;
  return <Tag label="New" icon="sparkles" />;
}

interface Props {
  item: QueueItem;
  onCall: () => void;
  /** visually emphasise the call button (first card) */
  highlight?: boolean;
  /** false hides the New / High / campaign tags under the contact */
  showTags?: boolean;
}

export function QueueCard({ item, onCall, highlight = false, showTags = true }: Props) {
  const { contact } = item;
  const priority = PRIORITY_LABEL[contact.priority];
  const last = parseIso(item.last_called_at);
  return (
    <div className="row-card">
      <Link to={`/contact/${contact.id}`} className="row-open" aria-label={`Open ${contact.name}`}>
        <Avatar name={contact.name} size={50} />
        <span className="row-body">
          <Text variant="h3" lines={1}>
            {contact.name}
          </Text>
          <Text variant="small" color="muted" lines={1}>
            {formatPhone(contact.phone)}
            {contact.location ? `  •  ${contact.location}` : ""}
          </Text>
          {showTags ? (
            <span className="tags">
              <ReasonTag item={item} />
              {priority && contact.priority === 1 ? <Tag label={priority.label} color={priority.color} background={priority.bg} /> : null}
              {item.campaign ? <Tag label={item.campaign.name} icon="tag" color={colors.purple} background={colors.purpleSoft} /> : null}
            </span>
          ) : null}
          {last ? (
            <Text variant="caption" color="faint" className="row-last">
              Last called {timeAgo(last)}
            </Text>
          ) : null}
        </span>
      </Link>
      <button type="button" className={["call-btn", highlight ? "call-btn-hi" : ""].filter(Boolean).join(" ")} onClick={onCall} aria-label={`Call ${contact.name}`} data-testid={`call-${contact.id}`}>
        <Icon name="phone" size={22} color={colors.white} />
      </button>
    </div>
  );
}
