import { Link } from "react-router";

import { formatPhone } from "@/lib/format";
import { contactStatusLook } from "@/lib/status";
import { colors, GREY_SOFT } from "@/lib/theme";
import type { Contact } from "@/lib/types";

import { Avatar } from "./Avatar";
import { Tag } from "./Chip";
import { Icon } from "./Icon";
import { Text } from "./Text";

interface Props {
  contact: Contact;
  onCall?: () => void;
}

export function ContactRow({ contact, onCall }: Props) {
  const status = contactStatusLook(contact.status);
  const blocked = contact.status === "do_not_contact";
  return (
    <div className="row-card">
      <Link to={`/contact/${contact.id}`} className="row-open" aria-label={`Open ${contact.name}`}>
        <Avatar name={contact.name} size={46} />
        <span className="row-body">
          <Text variant="h3" lines={1}>
            {contact.name}
          </Text>
          <Text variant="small" color="muted" lines={1}>
            {formatPhone(contact.phone)}
            {contact.location ? `  •  ${contact.location}` : ""}
          </Text>
          <span className="tags">
            <Tag label={status.label} color={status.color} background={status.bg} />
            {contact.category ? <Tag label={contact.category} color={colors.inkSoft} background={GREY_SOFT} /> : null}
          </span>
        </span>
      </Link>
      {onCall && !blocked ? (
        <button type="button" className="call-btn call-btn-sm" onClick={onCall} aria-label={`Call ${contact.name}`}>
          <Icon name="phone" size={20} color={colors.white} />
        </button>
      ) : null}
    </div>
  );
}
