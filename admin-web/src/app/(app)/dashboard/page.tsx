import type { Metadata } from "next";
import { Suspense } from "react";

import { DashboardView } from "@/components/views/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardView />
    </Suspense>
  );
}
