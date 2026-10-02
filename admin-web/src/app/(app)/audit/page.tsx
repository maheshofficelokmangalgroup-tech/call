import type { Metadata } from "next";

import { AuditView } from "@/components/views/audit-view";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AuditView />;
}
