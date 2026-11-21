import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { ConversationCentre } from "./conversation-centre";

export const metadata: Metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <>
      <PageHeader title="Conversations" description="Vendor chats, one thread per RFQ. Messages refresh every few seconds (polling, not live push)." />
      <main className="flex min-h-0 flex-1 flex-col lg:px-8 lg:py-6">
        <ConversationCentre />
      </main>
    </>
  );
}
