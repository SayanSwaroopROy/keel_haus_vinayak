import type { Metadata } from "next";
import { WorkOrdersView } from "./work-orders-view";

export const metadata: Metadata = { title: "Work Orders" };

export default function WorkOrdersPage() {
  return <WorkOrdersView />;
}
