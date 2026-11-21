import type { Metadata } from "next";
import { RfqDetail } from "./rfq-detail";

export const metadata: Metadata = { title: "RFQ" };

export default function RfqPage() {
  return <RfqDetail />;
}
