import type { Metadata } from "next";
import { Suspense } from "react";

import { CallsView } from "@/components/views/calls-view";

export const metadata: Metadata = { title: "Calls" };

export default function CallsPage() {
  return (
    <Suspense>
      <CallsView />
    </Suspense>
  );
}
