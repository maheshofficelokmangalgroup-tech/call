import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  padded?: boolean;
  tint?: string;
  testId?: string;
}

export function Card({ children, className, style, padded = true, tint, testId }: CardProps) {
  return (
    <div className={["card", padded ? "card-pad" : "", className].filter(Boolean).join(" ")} style={tint ? { backgroundColor: tint, ...style } : style} data-testid={testId}>
      {children}
    </div>
  );
}
