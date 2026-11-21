"use client";

import Link from "next/link";
import { LedgerSection, RfqStatusBadge } from "@/components/flow";
import { QueryState, Thread } from "@/components/ledger";
import { useRfqs } from "@/lib/api/hooks-flow";
import type { Rfq } from "@/lib/api/schemas-flow";
import { formatDay, reqNumber } from "@/lib/format";

const QUOTED = new Set(["QUOTATION_SUBMITTED", "AWARDED", "NOT_AWARDED"]);

function RfqRow({ rfq }: { rfq: Rfq }) {
  const quoted = rfq.vendors.filter((row) => QUOTED.has(row.status)).length;
  const open = rfq.status === "DRAFT";
  return (
    <li>
      <Link
        href={`/rfqs/${rfq.id}`}
        className="flex min-h-16 items-stretch gap-3 px-1 py-3 transition-colors hover:bg-ledger focus-visible:bg-ledger sm:gap-4"
      >
        <Thread open={open} />
        <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <span className="min-w-0">
            <span className="block font-medium">{rfq.category}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {reqNumber(rfq.requisition_id)} · {rfq.items.length} line{rfq.items.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="justify-self-end lg:order-last">
            <RfqStatusBadge status={rfq.status} />
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {rfq.status === "DRAFT" ? `${rfq.vendors.length} vendors chosen` : `${quoted} of ${rfq.vendors.length} quoted`}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">Due {formatDay(rfq.due_date)}</span>
        </span>
      </Link>
    </li>
  );
}

export function RfqList() {
  const query = useRfqs();
  const rfqs = query.data ?? [];
  const sections = [
    { key: "draft", title: "Ready to send", rows: rfqs.filter((row) => row.status === "DRAFT") },
    { key: "sent", title: "Out for quotation", rows: rfqs.filter((row) => row.status === "SENT") },
    { key: "awarded", title: "Vendors selected", rows: rfqs.filter((row) => row.status !== "DRAFT" && row.status !== "SENT") },
  ];

  return (
    <QueryState
      query={query}
      isEmpty={rfqs.length === 0}
      empty={{ title: "No RFQs yet", description: "Approve a requisition, then create its RFQ from the requisition page." }}
    >
      {sections.map((section) =>
        section.rows.length > 0 ? (
          <LedgerSection key={section.key} id={`rfq-${section.key}`} title={section.title} count={section.rows.length}>
            <ul className="flex flex-col divide-y divide-rule border-y border-rule">
              {section.rows.map((rfq) => (
                <RfqRow key={rfq.id} rfq={rfq} />
              ))}
            </ul>
          </LedgerSection>
        ) : null,
      )}
    </QueryState>
  );
}
