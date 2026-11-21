"use client";

import { BadgeCheckIcon, PencilIcon } from "lucide-react";
import { FlagBadges } from "@/components/flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { usePatchQuotation } from "@/lib/api/hooks-flow";
import type { Quotation, Rfq } from "@/lib/api/schemas-flow";
import { formatDay, formatInr, formatQty } from "@/lib/format";

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function missing(value: string | number | null, format: (input: string | number) => string = String): string {
  return value === null || value === "" ? "Not provided" : format(value);
}

function QuotationRow({ rfq, quotation, latest, locked, onEdit }: { rfq: Rfq; quotation: Quotation; latest: boolean; locked: boolean; onEdit: () => void }) {
  const patch = usePatchQuotation(rfq.id);
  const verified = quotation.status === "VERIFIED";

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-medium tabular-nums">Round {quotation.round}</h3>
        {latest ? <Badge variant="secondary">Latest, used in comparison</Badge> : <Badge variant="outline">Superseded</Badge>}
        {verified ? (
          <Badge variant="settled">
            <BadgeCheckIcon />
            Verified
          </Badge>
        ) : (
          <Badge variant="unsure">Needs checking</Badge>
        )}
        {quotation.quote_date ? <span className="text-xs text-muted-foreground tabular-nums">Dated {formatDay(quotation.quote_date)}</span> : null}
      </div>

      <FlagBadges flags={quotation.flags} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead className="text-right">Quoted qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Rate in RFQ unit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {quotation.items.map((line) => {
            const rfqItem = rfq.items.find((item) => item.id === line.rfq_item_id);
            const converted = line.uom_quoted !== null && rfqItem !== undefined && line.uom_quoted !== rfqItem.uom;
            return (
              <TableRow key={line.rfq_item_id ?? line.description}>
                <TableCell className="whitespace-normal">{line.description}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.qty_quoted === null ? "Not provided" : `${formatQty(line.qty_quoted)} ${line.uom_quoted ?? ""}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.rate === null ? "Not provided" : `${formatInr(line.rate, true)} / ${line.uom_quoted ?? "?"}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.rate_in_rfq_uom === null ? (
                    <span className="text-unsure-foreground">Cannot convert</span>
                  ) : (
                    <>
                      {formatInr(line.rate_in_rfq_uom, true)} / {rfqItem?.uom}
                      {converted ? <span className="ml-1 text-xs text-unsure-foreground">converted</span> : null}
                    </>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <Term label="GST" value={quotation.gst_pct === null ? "Not provided" : `${quotation.gst_pct}% ${quotation.gst_included ? "included" : "extra"}`} />
        <Term label="Freight" value={missing(quotation.freight, (value) => formatInr(Number(value)))} />
        <Term label="Payment" value={missing(quotation.payment_terms)} />
        <Term label="Advance" value={missing(quotation.advance_pct, (value) => `${value}%`)} />
        <Term label="Can start in" value={missing(quotation.start_days, (value) => `${value} days`)} />
        <Term label="Warranty" value={missing(quotation.warranty)} />
      </dl>
      {quotation.remarks ? <p className="text-sm text-muted-foreground">{quotation.remarks}</p> : null}

      {latest && !locked ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PencilIcon data-icon="inline-start" />
            Correct
          </Button>
          {!verified ? (
            <Button
              size="sm"
              disabled={patch.isPending}
              onClick={() =>
                patch.mutate(
                  { id: quotation.id, input: { status: "VERIFIED" } },
                  {
                    onSuccess: () => toast.add({ title: "Quotation verified", type: "success" }),
                    onError: (error) => toast.add({ title: "Couldn't verify", description: describeError(error), type: "error" }),
                  },
                )
              }
            >
              <BadgeCheckIcon data-icon="inline-start" />
              Mark verified
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function QuotationsPanel({ rfq, quotations, locked, onEdit }: { rfq: Rfq; quotations: Quotation[]; locked: boolean; onEdit: (quotation: Quotation) => void }) {
  if (quotations.length === 0) {
    return <p className="text-sm text-muted-foreground">No quotations yet. Vendors quote in the mobile app, or you can enter one on the Vendors tab.</p>;
  }
  return (
    <div className="flex flex-col gap-8">
      {rfq.vendors
        .filter((row) => quotations.some((quote) => quote.vendor_id === row.vendor_id))
        .map((row) => {
          const own = quotations.filter((quote) => quote.vendor_id === row.vendor_id).sort((a, b) => b.round - a.round);
          return (
            <section key={row.vendor_id} aria-label={row.vendor_name} className="flex flex-col">
              <h2 className="text-lg font-medium">{row.vendor_name}</h2>
              <ul className="flex flex-col divide-y divide-rule border-y border-rule">
                {own.map((quote, index) => (
                  <QuotationRow key={quote.id} rfq={rfq} quotation={quote} latest={index === 0} locked={locked} onEdit={() => onEdit(quote)} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
