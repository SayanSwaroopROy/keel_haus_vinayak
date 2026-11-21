export type QuoteLine = { qty: number | null; rate: number | null };

export type QuoteTotals = {
  subtotal: number;
  gst: number | null;
  freight: number;
  total: number | null;
  /** True when a line has no quantity or rate, so the figures above leave it out. */
  incomplete: boolean;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

// The vendor's own stated figures at the quantities it quoted. Not a comparison: the HOD's statement
// reprices every vendor at the RFQ quantities. A missing number stays missing and is never guessed.
export function quoteTotals(lines: QuoteLine[], gstPct: number | null, gstIncluded: boolean | null, freight: number | null): QuoteTotals {
  let subtotal = 0;
  let incomplete = false;
  for (const line of lines) {
    if (line.qty === null || line.rate === null) {
      incomplete = true;
      continue;
    }
    subtotal += line.qty * line.rate;
  }
  const gst = gstPct === null ? null : gstIncluded === true ? 0 : round2((subtotal * gstPct) / 100);
  const freightValue = freight ?? 0;
  const total = gst === null ? null : round2(subtotal + gst + freightValue);
  return { subtotal: round2(subtotal), gst, freight: freightValue, total, incomplete };
}
