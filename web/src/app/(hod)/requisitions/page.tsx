import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { RequisitionList } from "./requisition-list";

export const metadata: Metadata = { title: "Requisitions" };

export default function RequisitionsPage() {
  return (
    <>
      <PageHeader title="Requisitions" description="Every requirement raised from site, newest first." />
      <main className="flex flex-col gap-4 px-4 py-6 sm:px-8">
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <RequisitionList />
        </Suspense>
      </main>
    </>
  );
}
