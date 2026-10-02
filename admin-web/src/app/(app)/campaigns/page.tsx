import type { Metadata } from "next";

import { CampaignsView } from "@/components/views/campaigns-view";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return <CampaignsView />;
}
