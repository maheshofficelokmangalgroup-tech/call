"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * One value kept in the address (`?call=123`, `?new=1`), so a refresh keeps it, the browser's back button undoes it and the
 * link can be shared.
 *
 * It changes the address with the History API, which Next.js picks up (useSearchParams updates) WITHOUT navigating: the page
 * keeps its state. `router.replace` would load the page again and reset everything typed or chosen on it - the search box,
 * the filters, the selected rows.
 *
 * Pages that use this must render inside a <Suspense> boundary (a Next.js rule for useSearchParams).
 */
export function useUrlParam(name: string): readonly [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const value = params.get(name);

  const set = React.useCallback(
    (next: string | null) => {
      const url = new URL(window.location.href);
      if (next === null) url.searchParams.delete(name);
      else url.searchParams.set(name, next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    },
    [name],
  );

  return [value, set] as const;
}
