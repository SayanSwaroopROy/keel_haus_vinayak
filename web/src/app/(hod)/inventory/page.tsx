import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/app-shell";
import { InventoryView } from "./inventory-view";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <>
      <PageHeader title="Inventory" description="Site stock per project. Available = physical − reserved." />
      <main className="flex flex-col gap-4 px-4 py-6 sm:px-8">
        <InventoryView />
      </main>
    </>
  );
}
