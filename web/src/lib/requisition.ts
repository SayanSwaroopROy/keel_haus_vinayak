import type { ReqItem, Requisition, StockRow } from "@/lib/api/schemas";

export type Blocker = { kind: "unsure" | "duplicate" | "missing_code" | "stock_short"; label: string; count: number };

export function itemIsUnsure(row: ReqItem): boolean {
  return row.uncertain_fields.length > 0 || row.quantity === null || row.uom === null;
}

export function requisitionBlockers(requisition: Requisition, stock?: StockRow[]): Blocker[] {
  const unsure = requisition.items.filter(itemIsUnsure).length;
  const duplicates = requisition.items.filter((row) => row.duplicate_of.length > 0).length;
  const missingCode = requisition.items.filter((row) => row.item_code === null).length;
  const short = stock?.filter((row) => (row.to_procure ?? 0) > 0).length ?? 0;
  const blockers: Blocker[] = [];
  if (unsure > 0) blockers.push({ kind: "unsure", count: unsure, label: `${unsure} unsure` });
  if (duplicates > 0) blockers.push({ kind: "duplicate", count: duplicates, label: `${duplicates} duplicate code${duplicates > 1 ? "s" : ""}` });
  if (missingCode > 0) blockers.push({ kind: "missing_code", count: missingCode, label: `${missingCode} without ERP code` });
  if (short > 0) blockers.push({ kind: "stock_short", count: short, label: `${short} to procure` });
  return blockers;
}

export const INPUT_TYPE_LABEL: Record<Requisition["input_type"], string> = {
  voice: "Voice note",
  image: "Photo",
  pdf: "PDF",
  csv: "CSV",
  xlsx: "Spreadsheet",
  docx: "Word document",
  txt: "Text file",
  text: "Pasted text",
};

export const FIELD_LABEL: Record<string, string> = {
  quantity: "Quantity",
  uom: "Unit",
  spec: "Specification",
  brand: "Brand",
  description: "Description",
  wo_code: "WO code",
};
