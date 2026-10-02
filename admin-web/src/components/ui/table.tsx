import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Horizontally scrollable table shell with a rounded border. */
export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto rounded-2xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-[720px] border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-muted", className)} {...props} />;
}

export function TR({ className, interactive, ...props }: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn("border-t border-line transition-colors first:border-t-0", interactive && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2", className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("whitespace-nowrap px-4 py-3 font-semibold", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

/** A column header that can sort: shows the direction of the active column. */
export function SortHead({
  label,
  active,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onSort: () => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TH className={align === "right" ? "text-right" : undefined} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onSort}
        className={cn("inline-flex items-center gap-1 rounded-md uppercase tracking-wide transition-colors hover:text-ink", active && "text-ink", align === "right" && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-50")} />
      </button>
    </TH>
  );
}
