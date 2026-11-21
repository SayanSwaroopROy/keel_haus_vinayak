import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { RfqCreate } from "./rfq-create";

export const metadata: Metadata = { title: "Create RFQ" };

export default function NewRfqPage() {
  return (
    <>
      <PageHeader
        title="Create RFQ"
        description="Choose who is asked to quote. This makes a draft. Nothing is sent until you send it."
      />
      <main className="flex flex-col gap-8 px-4 py-6 pb-28 sm:px-8 lg:pb-8">
        <RfqCreate />
      </main>
    </>
  );
}
