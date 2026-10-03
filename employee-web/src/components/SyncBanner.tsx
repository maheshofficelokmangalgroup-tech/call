import { Icon } from "./Icon";
import { Text } from "./Text";

interface Props {
  /** true when the last request could not reach the server */
  offline: boolean;
  onRetry?: () => void;
}

/** "You are offline" strip shown above a list that could not be refreshed. */
export function SyncBanner({ offline, onRetry }: Props) {
  if (!offline) return null;
  return (
    <div className="banner" role="status" data-testid="offline-banner">
      <Icon name="wifi-off" size={18} />
      <Text variant="smallMedium" as="span" className="banner-text">
        Cannot reach the server. Showing what was loaded last.
      </Text>
      {onRetry ? (
        <button type="button" className="banner-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
