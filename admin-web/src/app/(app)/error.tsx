"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/states";

/** Shown when a page crashes while it is being drawn. The rest of the panel (menu, top bar) keeps working. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <ErrorState title="This page ran into a problem" message="It is not your fault. Try again; if it keeps happening, tell your administrator." onRetry={reset} />
    </div>
  );
}
