import type { Metadata } from "next";
import { RequisitionDetail } from "./requisition-detail";

export const metadata: Metadata = { title: "Requisition" };

export default function RequisitionPage() {
  return <RequisitionDetail />;
}
