import * as React from "react";

export interface TooltipRow {
  label: string;
  value: React.ReactNode;
  color?: string;
}

/** The small card shown while hovering a chart. Charts build their own rows and hand them over. */
export function TooltipCard({ title, rows }: { title?: React.ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-36 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs shadow-pop">
      {title ? <p className="mb-1.5 font-bold text-ink">{title}</p> : null}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-muted">
              {row.color ? <span className="size-2 rounded-full" style={{ background: row.color }} /> : null}
              {row.label}
            </span>
            <span className="font-bold text-ink tnum">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What Recharts passes to a custom tooltip - only the parts we read. */
export interface RechartsTooltipProps<T> {
  active?: boolean;
  payload?: { payload: T }[];
}
