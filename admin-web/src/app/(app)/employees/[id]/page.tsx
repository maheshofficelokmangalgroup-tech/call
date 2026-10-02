import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmployeeDetailView } from "@/components/views/employee-detail-view";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  return (
    <Suspense>
      <EmployeeDetailView id={Number(id)} />
    </Suspense>
  );
}
