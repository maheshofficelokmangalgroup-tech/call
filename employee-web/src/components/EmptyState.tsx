import { colors } from "@/lib/theme";

import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

interface Props {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: string;
  toneSoft?: string;
}

/** Friendly empty/error state (static: nothing floats or fades in). */
export function EmptyState({ icon, title, message, actionLabel, onAction, tone = colors.green, toneSoft = colors.greenSoft }: Props) {
  return (
    <div className="empty">
      <span className="empty-disc" style={{ backgroundColor: toneSoft }}>
        <Icon name={icon} size={40} color={tone} />
      </span>
      <Text variant="h1" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" color="muted" align="center" className="empty-message">
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onClick={onAction} size="md" variant="soft" className="empty-action" /> : null}
    </div>
  );
}
