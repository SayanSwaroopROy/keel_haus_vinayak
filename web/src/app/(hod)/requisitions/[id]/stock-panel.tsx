"use client";

import { DummyBadge, Figure, QueryState } from "@/components/ledger";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useStockCheck } from "@/lib/api/hooks";
import type { Requisition, StockRow } from "@/lib/api/schemas";
import { formatQty } from "@/lib/format";
import { cn } from "cn";

export type StockLine =
  | { kind: "checked"; id: string; description: string; row: StockRow }
  | { kind: "work"; id: string; description: string }
  | { kind: "unchecked"; id: string; description: string; reason: string };

export function stockLines(requisition: Requisition, rows: StockRow[]): StockLine[] {
  return requisition.items.map((item) => {
    if (item.kind === "work") return { kind: "work", id: item.id, description: item.description };
    const row = rows.find((stock) => stock.req_item_id === item.id);
    if (row) return { kind: "checked", id: item.id, description: item.description, row };
    const reason = item.quantity === null ? "quantity not provided" : item.uom === null ? "unit not provided" : "no stock record";
    return { kind: "unchecked", id: item.id, description: item.description, reason };
  });
}

export function StockPanel({ requisition }: { requisition: Requisition }) {
  const query = useStockCheck(requisition.id);
  const lines = stockLines(requisition, query.data ?? []);
  const anyDummy = query.data?.some((row) => row.is_dummy) ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Available = physical − reserved. Anything not covered is procured through RFQ. Work items are labour and skip the check.
        </p>
        {anyDummy ? <DummyBadge>Stock levels are demo data</DummyBadge> : null}
      </div>
      <QueryState query={query}>
        <div className="overflow-x-auto">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Physical</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">To procure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id} className="hover:bg-transparent">
                  <TableCell className="whitespace-normal font-medium">{line.description}</TableCell>
                  {line.kind === "checked" ? (
                    <>
                      <TableCell className="text-right">
                        <Figure value={formatQty(line.row.requested)} unit={line.row.uom} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(line.row.physical)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(line.row.reserved)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQty(line.row.available)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          line.row.to_procure > 0 ? "text-binding" : "text-settled",
                        )}
                      >
                        {line.row.to_procure > 0 ? formatQty(line.row.to_procure) : "Covered"}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={5} className="text-right text-muted-foreground">
                      {line.kind === "work" ? "N/A: work item" : `Not checked: ${line.reason}`}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </QueryState>
    </div>
  );
}
