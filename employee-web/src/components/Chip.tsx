import { colors, GREY_SOFT } from "@/lib/theme";

import { Icon, type IconName } from "./Icon";

interface ChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  icon?: IconName;
  /** accent colour used when selected */
  tone?: string;
  toneSoft?: string;
  size?: "md" | "sm";
  testId?: string;
}

/** Selectable pill. The fill colour and border change as soon as the selection changes (no animation). */
export function Chip({ label, selected = false, onClick, icon, tone = colors.green, toneSoft = colors.greenSoft, size = "md", testId }: ChipProps) {
  const fg = selected ? tone : colors.inkSoft;
  return (
    <button
      type="button"
      className={["chip", size === "sm" ? "chip-sm" : "", selected ? "chip-on" : ""].filter(Boolean).join(" ")}
      style={{ backgroundColor: selected ? toneSoft : colors.white, borderColor: selected ? tone : colors.border, color: fg }}
      aria-pressed={selected}
      onClick={onClick}
      data-testid={testId}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {label}
    </button>
  );
}

interface TagProps {
  label: string;
  color?: string;
  background?: string;
  icon?: IconName;
}

/** Small read-only label (status, priority, campaign ...). */
export function Tag({ label, color = colors.greenDark, background = colors.greenSoft, icon }: TagProps) {
  return (
    <span className="tag" style={{ color, backgroundColor: background }}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2.4} /> : null}
      {label}
    </span>
  );
}

export const greyTag = { color: colors.muted, background: GREY_SOFT } as const;
