import type { Metadata } from "next";
import { Suspense } from "react";

import { FollowupsView } from "@/components/views/followups-view";

export const metadata: Metadata = { title: "Follow-ups" };

export default function FollowupsPage() {
  return (
    <Suspense>
      <FollowupsView />
    </Suspense>
  );
}
