"use client";

import { CircleHelpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import { ConfidenceMark, Figure } from "@/components/ledger";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReqItem, Requisition } from "@/lib/api/schemas";
import { formatQty } from "@/lib/format";
import { FIELD_LABEL } from "@/lib/requisition";

function NotProvided({ field }: { field: string }) {
  return (
    <Badge variant="unsure" aria-label={`${FIELD_LABEL[field] ?? field} not provided`}>
      Not provided
    </Badge>
  );
}

function isUnsure(row: ReqItem, field: string): boolean {
  return row.uncertain_fields.includes(field);
}

function Quantity({ row }: { row: ReqItem }) {
  if (row.quantity === null) return <NotProvided field="quantity" />;
  const converted = row.original_qty !== null && row.original_uom !== null && row.original_uom !== row.uom;
  return (
    <span className="flex flex-col items-end gap-0.5">
      {row.uom === null ? (
        <span className="flex items-center gap-1.5">
          <Figure value={formatQty(row.quantity)} />
          <NotProvided field="uom" />
        </span>
      ) : (
        <Figure value={formatQty(row.quantity)} unit={row.uom} className="font-medium" />
      )}
      {converted ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          said {formatQty(row.original_qty)} {row.original_uom}
        </span>
      ) : null}
      {row.extra_pct !== null ? <span className="text-xs text-muted-foreground tabular-nums">+{row.extra_pct}% extra</span> : null}
    </span>
  );
}

function Description({ row }: { row: ReqItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium text-pretty">{row.description}</span>
      <Line label="Spec" unsure={isUnsure(row, "spec")}>
        {row.spec}
      </Line>
      <Line label="Brand" unsure={isUnsure(row, "brand")}>
        {row.brand}
      </Line>
      {row.remarks ? <span className="text-xs text-muted-foreground">{row.remarks}</span> : null}
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {row.wo_code ? <span>WO {row.wo_code}</span> : null}
        <span>{row.item_code ? `ERP ${row.item_code}` : "No ERP code yet"}</span>
        {row.source_ref ? <span>from {row.source_ref}</span> : null}
      </span>
    </div>
  );
}

function Line({ label, unsure, children }: { label: string; unsure: boolean; children: ReactNode }) {
  if (!children && !unsure) return null;
  return (
    <span className={cn("text-sm text-pretty", unsure && "rounded-sm bg-unsure-soft px-1 text-unsure-foreground")}>
      <span className="text-muted-foreground">{label}: </span>
      {children ?? "not provided"}
    </span>
  );
}

function Question({ row }: { row: ReqItem }) {
  if (!row.clarification_question) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-unsure-foreground">
      <CircleHelpIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="sr-only">Open question: </span>
        {row.clarification_question}
      </span>
    </p>
  );
}

export function ItemsPanel({ requisition }: { requisition: Requisition }) {
  const rows = requisition.items;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No lines were extracted from this requisition.</p>;
  }
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>Line</TableHead>
              <TableHead className="w-24">Kind</TableHead>
              <TableHead className="w-40 text-right">Quantity</TableHead>
              <TableHead className="w-32">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={row.id}
                className={cn("align-top hover:bg-transparent", row.uncertain_fields.length > 0 && "bg-unsure-soft/40")}
              >
                <TableCell className="text-right text-muted-foreground tabular-nums">{index + 1}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col gap-2">
                    <Description row={row} />
                    <Question row={row} />
                    {row.duplicate_of.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Possible duplicate of{" "}
                        {row.duplicate_of.map((dup) => `${dup.code} (${dup.description})`).join(", ")}. Resolve in ERP codes.
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="capitalize">{row.kind}</TableCell>
                <TableCell className="text-right">
                  <Quantity row={row} />
                </TableCell>
                <TableCell>
                  <ConfidenceMark confidence={row.confidence} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ol className="flex flex-col divide-y divide-rule border-y border-rule md:hidden">
        {rows.map((row, index) => (
          <li key={row.id} className={cn("flex flex-col gap-3 py-4", row.uncertain_fields.length > 0 && "bg-unsure-soft/40 px-3")}>
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                Line {index + 1} · <span className="capitalize">{row.kind}</span>
              </span>
              <ConfidenceMark confidence={row.confidence} />
            </div>
            <Description row={row} />
            <div className="flex items-center justify-between gap-3 border-t border-rule pt-2">
              <span className="text-xs text-muted-foreground">Quantity</span>
              <Quantity row={row} />
            </div>
            <Question row={row} />
          </li>
        ))}
      </ol>
    </>
  );
}
