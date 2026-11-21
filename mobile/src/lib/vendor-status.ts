import type { RfqVendorStatus, WorkOrderStatus } from '@/lib/api/schemas-vendor';
import { figure } from '@/lib/format';

export type Tone = 'decision' | 'waiting' | 'settled' | 'closed';

// What each RFQ means for the vendor, in the vendor's words. `decision` means the vendor must act.
export const RFQ_STATUS: Record<RfqVendorStatus, { label: string; tone: Tone }> = {
  RFQ_SENT: { label: 'New RFQ', tone: 'decision' },
  RFQ_VIEWED: { label: 'Quote due', tone: 'decision' },
  VENDOR_RESPONDED: { label: 'Quote due', tone: 'decision' },
  ALTERNATIVE_PROPOSED: { label: 'Alternative with HOD', tone: 'waiting' },
  ALTERNATIVE_APPROVED: { label: 'Alternative accepted', tone: 'decision' },
  ALTERNATIVE_REJECTED: { label: 'Alternative declined', tone: 'decision' },
  QUOTATION_SUBMITTED: { label: 'Quote submitted', tone: 'waiting' },
  REVISION_REQUESTED: { label: 'Revised quote asked', tone: 'decision' },
  AWARDED: { label: 'Awarded to you', tone: 'settled' },
  NOT_AWARDED: { label: 'Not awarded', tone: 'closed' },
};

export type RfqFilter = 'all' | 'act' | 'waiting' | 'done';

export const RFQ_FILTERS: { key: RfqFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'act', label: 'Needs you' },
  { key: 'waiting', label: 'With Vinayak' },
  { key: 'done', label: 'Closed' },
];

export function matchesFilter(status: RfqVendorStatus, filter: RfqFilter): boolean {
  const tone = RFQ_STATUS[status].tone;
  if (filter === 'all') return true;
  if (filter === 'act') return tone === 'decision';
  if (filter === 'waiting') return tone === 'waiting';
  return tone === 'settled' || tone === 'closed';
}

export function canQuote(status: RfqVendorStatus): boolean {
  return status !== 'AWARDED' && status !== 'NOT_AWARDED';
}

export const WO_STATUS: Record<WorkOrderStatus, { label: string; tone: Tone }> = {
  GENERATED: { label: 'Being prepared', tone: 'waiting' },
  PENDING_APPROVAL: { label: 'Being approved', tone: 'waiting' },
  SENT: { label: 'Issued to you', tone: 'decision' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'settled' },
  COMPLETED: { label: 'Completed', tone: 'settled' },
  CANCELLED: { label: 'Cancelled', tone: 'closed' },
};

// Server flags, said plainly to the vendor.
export const FLAG_LABEL: Record<string, string> = {
  expired_offer: 'The offer has expired',
  unit_mismatch: 'A unit differs from the RFQ',
  qty_differs_from_rfq: 'A quantity differs from the RFQ',
  missing_terms: 'Payment terms are missing',
  brand_substitution: 'A brand differs from the RFQ',
  escalation_clause: 'Includes an escalation clause',
  undated: 'The quote has no date',
  payment_terms_open: 'Payment terms are left open',
};

export function flagLabel(flag: string): string {
  return FLAG_LABEL[flag] ?? flag.replace(/_/g, ' ');
}

export function rupees(value: number): string {
  return `₹${figure(value)}`;
}

export function dueLabel(dueDate: string): { text: string; overdue: boolean } {
  const due = new Date(`${dueDate.slice(0, 10)}T23:59:59`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const dateText = due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (days < 0) return { text: `Was due ${dateText}`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: false };
  if (days === 1) return { text: `Due tomorrow, ${dateText}`, overdue: false };
  return { text: `Due ${dateText}, in ${days} days`, overdue: false };
}
