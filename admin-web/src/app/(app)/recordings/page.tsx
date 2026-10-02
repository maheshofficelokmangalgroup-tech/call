import type { Metadata } from "next";
import { Suspense } from "react";

import { RecordingsView } from "@/components/views/recordings-view";

export const metadata: Metadata = { title: "Recordings" };

export default function RecordingsPage() {
  return (
    <Suspense>
      <RecordingsView />
    </Suspense>
  );
}
