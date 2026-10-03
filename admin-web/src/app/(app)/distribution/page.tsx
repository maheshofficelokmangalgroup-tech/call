import type { Metadata } from "next";

import { DistributionView } from "@/components/views/distribution-view";

export const metadata: Metadata = { title: "Work sharing" };

export default function DistributionPage() {
  return <DistributionView />;
}
