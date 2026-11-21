import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { RfqList } from "./rfq-list";

export const metadata: Metadata = { title: "RFQs" };

export default function RfqsPage() {
  return (
    <>
      <PageHeader
        title="RFQs"
        description="Requests for quotation. Nothing reaches a vendor until you send it, and no vendor is selected for you."
      />
      <main className="flex flex-col gap-8 px-4 py-6 sm:px-8">
        <RfqList />
      </main>
    </>
  );
}
