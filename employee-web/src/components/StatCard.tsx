import { Link } from "react-router";

import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

interface Props {
  label: string;
  value: number;
  icon: IconName;
  tone: string;
  toneSoft: string;
  /** a route to open when the card is tapped */
  to?: string;
  testId?: string;
}

/** Compact stat tile: the icon sits beside the number and its label. */
export function StatCard({ label, value, icon, tone, toneSoft, to, testId }: Props) {
  const body = (
    <>
      <span className="stat-icon" style={{ backgroundColor: toneSoft }}>
        <Icon name={icon} size={20} color={tone} />
      </span>
      <span className="stat-text">
        <Text variant="number" className="stat-number">
          {value}
        </Text>
        <Text variant="small" color="muted" lines={1}>
          {label}
        </Text>
      </span>
    </>
  );
  return to ? (
    <Link to={to} className="stat" data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="stat" data-testid={testId}>
      {body}
    </div>
  );
}
