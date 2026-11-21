import type { Vendor } from "../schemas";
import type { EvalRow, EvalWeights, Evaluation, QuoteItem, Quotation, QuotationInput, Rfq } from "../schemas-flow";

// Pure functions behind the mock quotation and evaluation endpoints. The real backend computes these
// server-side; the web only displays the result, so nothing here ships to production behaviour.

export const MOCK_NOW = new Date(Date.UTC(2026, 10, 21, 12, 0, 0));

export const DEFAULT_WEIGHTS: EvalWeights = { price: 50, performance: 20, compliance: 10, delivery: 10, terms: 10 };

/** How many `quoted` units fit in one `rfq` unit. Null when the two units cannot be converted. */
export function unitsPer(rfqUom: string, quotedUom: string): number | null {
  if (rfqUom === quotedUom) return 1;
  const table: Record<string, number> = {
    "SQM>SQFT": 10.7639,
    "SQFT>SQM": 0.092903,
    "CUM>CFT": 35.3147,
    "CFT>CUM": 0.0283168,
  };
  return table[`${rfqUom}>${quotedUom}`] ?? null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function buildQuotation(
  rfq: Rfq,
  vendorId: string,
  round: number,
  input: Omit<QuotationInput, "vendor_id">,
  id: string,
  status: string,
): Quotation {
  const items: QuoteItem[] = input.items.map((line) => {
    const rfqItem = rfq.items.find((row) => row.id === line.rfq_item_id);
    const factor = rfqItem ? unitsPer(rfqItem.uom, line.uom_quoted) : null;
    const rateInRfqUom = line.rate !== null && factor !== null ? round2(line.rate * factor) : null;
    return {
      rfq_item_id: line.rfq_item_id,
      description: rfqItem?.description ?? "Unknown line",
      uom_quoted: line.uom_quoted,
      qty_quoted: line.qty_quoted,
      rate: line.rate,
      amount: line.rate !== null && line.qty_quoted !== null ? round2(line.rate * line.qty_quoted) : null,
      rate_in_rfq_uom: rateInRfqUom,
      confidence: 1,
      raw: { source: "app_form" },
    };
  });

  const flags = new Set<string>();
  let expired: boolean | null = null;
  if (!input.quote_date) flags.add("undated");
  else if (input.validity_days !== null) {
    const lapses = new Date(input.quote_date).getTime() + input.validity_days * 86_400_000;
    expired = lapses < MOCK_NOW.getTime();
    if (expired) flags.add("expired_offer");
  }
  for (const line of items) {
    const rfqItem = rfq.items.find((row) => row.id === line.rfq_item_id);
    if (!rfqItem) continue;
    if (line.uom_quoted && line.uom_quoted !== rfqItem.uom) flags.add("unit_mismatch");
    const factor = line.uom_quoted ? unitsPer(rfqItem.uom, line.uom_quoted) : null;
    if (line.qty_quoted !== null && factor !== null && Math.abs(line.qty_quoted / factor - rfqItem.quantity) > 0.5) {
      flags.add("qty_differs_from_rfq");
    }
  }
  if (!input.payment_terms) flags.add("payment_terms_open");
  if (!input.warranty) flags.add("missing_terms");
  if (input.escalation_clause) flags.add("escalation_clause");
  const demandedBrands = rfq.items.map((row) => row.brand).filter((brand): brand is string => brand !== null);
  if (demandedBrands.length > 0 && input.brands.length > 0 && !input.brands.some((brand) => demandedBrands.includes(brand))) {
    flags.add("brand_substitution");
  }

  return {
    id,
    rfq_id: rfq.id,
    vendor_id: vendorId,
    round,
    source: "app_form",
    status,
    quote_date: input.quote_date,
    validity_days: input.validity_days,
    expired,
    gst_pct: input.gst_pct,
    gst_included: input.gst_included,
    freight: input.freight,
    payment_terms: input.payment_terms,
    advance_pct: input.advance_pct,
    start_days: input.start_days,
    warranty: input.warranty,
    escalation_clause: input.escalation_clause,
    brands: input.brands,
    items,
    confidence: 1,
    flags: [...flags],
    remarks: input.remarks,
  };
}

function termsScore(quote: Quotation): number {
  let score = 100;
  if (!quote.payment_terms) score -= 30;
  if ((quote.advance_pct ?? 0) > 10) score -= 20;
  if (!quote.warranty) score -= 20;
  if (quote.escalation_clause) score -= 20;
  return Math.max(0, score);
}

function performanceScore(vendor: Vendor | undefined): number | null {
  const performance = vendor?.performance;
  if (!performance) return null;
  return Math.round(((performance.quality + performance.delivery + (6 - performance.disputes)) / 15) * 100);
}

type Selection = { rfq_item_id: string; vendor_id: string };

export function computeEvaluation(args: {
  id: string;
  rfq: Rfq;
  quotations: Quotation[];
  vendors: Vendor[];
  weights: EvalWeights;
  selections: Selection[] | null;
  note: string | null;
}): Evaluation {
  const { rfq, quotations, vendors, weights } = args;
  const vendorIds = [...new Set(quotations.map((row) => row.vendor_id))];

  const draft = vendorIds.map((vendorId) => {
    const rounds = quotations.filter((row) => row.vendor_id === vendorId).sort((a, b) => a.round - b.round);
    const latest = rounds[rounds.length - 1];
    const vendor = vendors.find((row) => row.id === vendorId);
    const priceRound = (quote: Quotation) => {
      const lines = rfq.items.map((item) => {
        const rate = quote.items.find((row) => row.rfq_item_id === item.id)?.rate_in_rfq_uom ?? null;
        return { rfq_item_id: item.id, rate_in_rfq_uom: rate, line_total: rate === null ? null : round2(rate * item.quantity) };
      });
      const subtotal = round2(lines.reduce((sum, row) => sum + (row.line_total ?? 0), 0));
      const gst = quote.gst_included || quote.gst_pct === null ? 0 : round2((subtotal * quote.gst_pct) / 100);
      const freight = quote.freight ?? 0;
      return { lines, subtotal, gst, freight, landed: round2(subtotal + gst + freight) };
    };
    const priced = priceRound(latest);
    return {
      vendorId,
      vendorName: vendor?.name ?? "Unknown vendor",
      latest,
      rounds: rounds.map((row) => ({ round: row.round, landed_total: priceRound(row).landed })),
      priced,
      performance: performanceScore(vendor),
    };
  });

  const lowest = Math.min(...draft.map((row) => row.priced.landed).filter((value) => value > 0));
  const fastest = Math.min(...draft.map((row) => row.latest.start_days ?? Infinity));
  const bestPerformance = Math.max(...draft.map((row) => row.performance ?? -1));

  const scored = draft.map((row) => {
    const price = row.priced.landed > 0 ? Math.round((lowest / row.priced.landed) * 100) : 0;
    const compliance = Math.max(0, 100 - row.latest.flags.length * 15);
    const delivery = row.latest.start_days === null ? null : row.latest.start_days === 0 ? 100 : Math.round((fastest / row.latest.start_days) * 100);
    const terms = termsScore(row.latest);
    const parts: Array<[number | null, number]> = [
      [price, weights.price],
      [row.performance, weights.performance],
      [compliance, weights.compliance],
      [delivery, weights.delivery],
      [terms, weights.terms],
    ];
    const used = parts.filter((part): part is [number, number] => part[0] !== null);
    const weightSum = used.reduce((sum, part) => sum + part[1], 0) || 1;
    const finalScore = Math.round(used.reduce((sum, part) => sum + part[0] * part[1], 0) / weightSum);
    return { row, price, compliance, delivery, terms, finalScore };
  });

  const order = [...scored].sort((a, b) => b.finalScore - a.finalScore);

  const rows: EvalRow[] = scored.map(({ row, price, compliance, delivery, terms, finalScore }) => {
    const rank = order.findIndex((entry) => entry.row.vendorId === row.vendorId) + 1;
    const badges: EvalRow["badges"] = [];
    if (row.priced.landed === lowest) badges.push("lowest_price");
    if (row.performance !== null && row.performance === bestPerformance) badges.push("best_performance");
    if (row.latest.start_days !== null && row.latest.start_days === fastest) badges.push("fastest_start");
    if (rank === 1) badges.push("best_overall");
    return {
      vendor_id: row.vendorId,
      vendor_name: row.vendorName,
      quotation_id: row.latest.id,
      blocked: vendors.find((vendor) => vendor.id === row.vendorId)?.status === "blocked",
      performance_is_dummy: vendors.find((vendor) => vendor.id === row.vendorId)?.performance?.is_dummy ?? false,
      round: row.latest.round,
      rounds: row.rounds,
      line_items: row.priced.lines,
      subtotal_at_rfq_qty: row.priced.subtotal,
      gst: row.priced.gst,
      freight: row.priced.freight,
      landed_total: row.priced.landed,
      scores: { price, performance: row.performance, compliance, delivery, terms },
      final_score: finalScore,
      rank,
      badges,
      flags: row.latest.flags,
    };
  });

  const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const perItem = rfq.items.map((item) => {
    const offers = rows
      .map((row) => ({ row, line: row.line_items.find((entry) => entry.rfq_item_id === item.id) }))
      .filter((entry): entry is { row: EvalRow; line: EvalRow["line_items"][number] & { line_total: number } } => entry.line?.line_total != null)
      .sort((a, b) => a.line.line_total - b.line.line_total);
    // An expired offer is never suggested while a live one exists. Price leads, performance breaks near-ties; the HOD still picks.
    const live = offers.filter((entry) => !entry.row.flags.includes("expired_offer"));
    const candidates = live.length > 0 ? live : offers;
    const pick =
      candidates.find((entry) => entry.row.vendor_id !== candidates[0]?.row.vendor_id && candidates[0] && entry.line.line_total <= candidates[0].line.line_total * 1.03 && (entry.row.scores.performance ?? 0) > (candidates[0].row.scores.performance ?? 0)) ??
      candidates[0];
    const quality = vendors.find((vendor) => vendor.id === pick?.row.vendor_id)?.performance;
    const second = candidates.find((entry) => entry.row.vendor_id !== pick?.row.vendor_id);
    return {
      rfq_item_id: item.id,
      vendor_id: pick?.row.vendor_id ?? null,
      reasoning: pick
        ? `${pick.row.vendor_name}: ${inr(pick.line.line_total)} for this line${second ? `, next lowest ${inr(second.line.line_total)}` : ""}${quality ? `; quality ${quality.quality}/5${quality.is_dummy ? " (demo history)" : ""}` : ""}. Computed from the table, the decision is yours.`
        : "No complete quote for this line.",
    };
  });

  return {
    id: args.id,
    rfq_id: rfq.id,
    weights,
    rows: rows.sort((a, b) => a.rank - b.rank),
    recommendation: {
      overall_vendor_id: order[0]?.row.vendorId ?? null,
      per_item: perItem,
      reasoning: order[0]
        ? `${order[0].row.vendorName} scores highest overall (${order[0].finalScore}) on the weights shown.`
        : "No quotations to compare yet.",
      basis: "Mock: weighted score of price, performance, compliance, delivery and terms.",
      source: "fallback",
    },
    item_selections: args.selections,
    hod_note: args.note,
  };
}
