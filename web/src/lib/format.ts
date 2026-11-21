const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function formatQty(value: number | null): string {
  return value === null ? "—" : qtyFormat.format(value);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function ageInDays(iso: string, now: Date = new Date()): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/** Requisition ids are UUIDs; show a short, stable ledger number. */
export function reqNumber(id: string): string {
  const tail = id.replace(/-/g, "").slice(-4).toUpperCase();
  return `REQ-${tail}`;
}

export function confidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

const inrWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inrFine = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupee amounts. Whole rupees for totals, two decimals for rates. Null is "—", never 0. */
export function formatInr(value: number | null, fine = false): string {
  if (value === null) return "—";
  return `₹${(fine ? inrFine : inrWhole).format(value)}`;
}

/** yyyy-mm-dd or ISO date strings, shown as 28 Nov 2026. Date-only strings are read as local calendar days. */
export function formatDay(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}
