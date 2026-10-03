import type { CSSProperties, MouseEventHandler } from "react";

import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "accent" | "soft" | "outline" | "danger" | "dark" | "white";
export type ButtonSize = "lg" | "md" | "sm";

interface Props {
  title: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

export function Button({ title, onClick, variant = "primary", size = "lg", icon, iconRight, loading, disabled, type = "button", className, style, testId }: Props) {
  const iconSize = size === "sm" ? 16 : 20;
  return (
    <button
      type={type}
      className={["btn", `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(" ")}
      style={style}
      onClick={loading ? undefined : onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-testid={testId}
    >
      {loading ? (
        <span className="spinner" role="status" aria-label="Please wait" />
      ) : (
        <>
          {icon ? <Icon name={icon} size={iconSize} /> : null}
          <span className="btn-label">{title}</span>
          {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
        </>
      )}
    </button>
  );
}
