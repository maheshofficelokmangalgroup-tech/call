import type { ReactNode } from "react";

import { clamp } from "@/lib/format";
import { colors } from "@/lib/theme";

interface Props {
  /** 0..1 (values above 1 are clamped) */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}

/** Circular progress (used for the daily target). The arc is drawn at its value straight away. */
export function ProgressRing({ progress, size = 132, stroke = 12, color = colors.yellow, track = "rgba(255,255,255,0.22)", children }: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(clamp(progress, 0, 1) * 100)} percent of today's target`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamp(progress, 0, 1))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
