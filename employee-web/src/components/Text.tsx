import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";

import { resolveColor } from "@/lib/theme";

export type TextVariant = "display" | "title" | "h1" | "h2" | "h3" | "body" | "bodyMedium" | "small" | "smallMedium" | "caption" | "button" | "number";

interface Props extends Omit<HTMLAttributes<HTMLElement>, "color"> {
  variant?: TextVariant;
  /** a theme colour name ("muted") or any CSS colour */
  color?: string;
  align?: "left" | "center" | "right";
  /** truncate after this many lines (1 = a single line with an ellipsis) */
  lines?: number;
  as?: ElementType;
  children?: ReactNode;
}

/** Text in one of the app's type styles (see .t-* in app.css). */
export function Text({ variant = "body", color, align, lines, as: Tag = "div", className, style, children, ...rest }: Props) {
  const css: CSSProperties = { ...style };
  const resolved = resolveColor(color);
  if (resolved) css.color = resolved;
  if (align) css.textAlign = align;
  const clamp = lines === 1 ? "clamp-1" : lines && lines > 1 ? "clamp-n" : "";
  if (lines && lines > 1) css.WebkitLineClamp = lines;
  return (
    <Tag {...rest} className={["t", `t-${variant}`, clamp, className].filter(Boolean).join(" ")} style={css}>
      {children}
    </Tag>
  );
}
