"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return total > 0 ? <p className="px-1 text-sm text-muted">{formatNumber(total)} result{total === 1 ? "" : "s"}</p> : null;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="px-1 text-sm text-muted tnum">
        {formatNumber(from)}-{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="size-4" /> Prev
        </Button>
        <span className="min-w-20 text-center text-sm font-semibold text-ink-soft tnum">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
