"use client";

import { FilePlus2Icon } from "lucide-react";
import Link from "next/link";
import { RfqStatusBadge } from "@/components/flow";
import { buttonVariants } from "@/components/ui/button";
import { useRfqs } from "@/lib/api/hooks-flow";
import type { Requisition } from "@/lib/api/schemas";
import { useSession } from "@/lib/auth/session";

/** From an approved requisition the HOD raises its RFQs, then follows them from here. */
export function RfqLinks({ requisition }: { requisition: Requisition }) {
  const role = useSession((state) => state.user?.role);
  const query = useRfqs();
  if (role !== "hod") return null;

  const own = (query.data ?? []).filter((row) => row.requisition_id === requisition.id);
  if (own.length > 0) {
    return (
      <section aria-label="RFQs for this requisition" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">RFQs</h2>
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {own.map((rfq) => (
            <li key={rfq.id}>
              <Link href={`/rfqs/${rfq.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:bg-ledger">
                <span>{rfq.category}</span>
                <RfqStatusBadge status={rfq.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (requisition.status !== "APPROVED") return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/rfqs/new?requisition=${requisition.id}`} className={buttonVariants({ size: "lg", className: "h-11 lg:h-9" })}>
        <FilePlus2Icon data-icon="inline-start" />
        Create RFQ
      </Link>
      <p className="text-sm text-muted-foreground">The shortfall after site stock goes to vendors as an RFQ.</p>
    </div>
  );
}
