import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { VendorsView } from "./vendors-view";

export const metadata: Metadata = { title: "Vendors" };

export default function VendorsPage() {
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Contractors and suppliers who receive RFQs. A vendor must complete the registration checklist before a Work Order can be raised."
      />
      <main className="flex flex-col gap-4 px-4 py-6 sm:px-8">
        <VendorsView />
      </main>
    </>
  );
}
