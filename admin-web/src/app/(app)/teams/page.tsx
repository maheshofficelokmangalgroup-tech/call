import type { Metadata } from "next";

import { TeamsView } from "@/components/views/teams-view";

export const metadata: Metadata = { title: "Teams" };

export default function TeamsPage() {
  return <TeamsView />;
}
