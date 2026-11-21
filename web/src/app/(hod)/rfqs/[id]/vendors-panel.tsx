"use client";

import { MessageSquareIcon, PencilLineIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { VendorStatusBadge } from "@/components/flow";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Quotation, Rfq } from "@/lib/api/schemas-flow";
import { formatRelative } from "@/lib/format";

export function VendorsPanel({
  rfq,
  quotations,
  locked,
  onEnter,
  onRevision,
}: {
  rfq: Rfq;
  quotations: Quotation[];
  /** True once the RFQ is a draft or a vendor is already selected: no quotes can change. */
  locked: boolean;
  onEnter: (vendorId: string, vendorName: string, nextRound: number) => void;
  onRevision: (vendorId: string, vendorName: string) => void;
}) {
  const draft = rfq.status === "DRAFT";
  return (
    <ul className="flex flex-col divide-y divide-rule border-y border-rule">
      {rfq.vendors.map((row) => {
        const rounds = quotations.filter((quote) => quote.vendor_id === row.vendor_id).length;
        return (
          <li key={row.vendor_id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
            <span className="min-w-0 font-medium">{row.vendor_name}</span>
            <span className="justify-self-end lg:justify-self-start">{draft ? <span className="text-sm text-muted-foreground">Not sent yet</span> : <VendorStatusBadge status={row.status} />}</span>
            <span className="col-span-2 text-xs text-muted-foreground tabular-nums lg:col-span-1">
              {rounds === 0 ? "No quotation" : `${rounds} round${rounds === 1 ? "" : "s"}`}
              {row.viewed_at ? ` · opened ${formatRelative(row.viewed_at)}` : ""}
            </span>
            <span className="col-span-2 flex flex-wrap items-center gap-1 lg:col-span-1 lg:justify-end">
              {draft ? null : (
                <Link href={`/conversations?rfq=${rfq.id}&vendor=${row.vendor_id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  <MessageSquareIcon data-icon="inline-start" />
                  Chat
                </Link>
              )}
              {!locked ? (
                <Button variant="outline" size="sm" onClick={() => onEnter(row.vendor_id, row.vendor_name, rounds + 1)}>
                  <PencilLineIcon data-icon="inline-start" />
                  {rounds === 0 ? "Enter quotation" : "Enter revised quote"}
                </Button>
              ) : null}
              {!locked && rounds > 0 && row.status !== "REVISION_REQUESTED" ? (
                <Button variant="outline" size="sm" onClick={() => onRevision(row.vendor_id, row.vendor_name)}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Ask for revision
                </Button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
