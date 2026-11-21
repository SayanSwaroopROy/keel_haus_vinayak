import type { Metadata } from "next";
import { WorkOrderDetail } from "./work-order-detail";

export const metadata: Metadata = { title: "Work Order" };

export default function WorkOrderPage() {
  return <WorkOrderDetail />;
}
