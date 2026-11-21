import type { Requisition, ReqItem, Vendor } from "../schemas";
import type {
  Alternative,
  Conversation,
  Message,
  Quotation,
  QuotationInput,
  Rfq,
  WorkOrder,
} from "../schemas-flow";
import { mockId } from "./fixtures";
import { DEFAULT_WEIGHTS, MOCK_NOW, buildQuotation, computeEvaluation } from "./quote-logic";
import type { EvaluationState } from "./store";

// Invented demo data only. Nothing here comes from the client data pack.

// The real six standard terms are loaded from the client's local data pack at seed time.
export const DEMO_TERMS = [
  "Rates are firm for the validity period (demo term).",
  "Payment as per the agreed schedule (demo term).",
  "Delivery to the project site (demo term).",
  "GST as applicable (demo term).",
  "Defects liability as per the work order (demo term).",
  "Vinayak may reject non-conforming supply (demo term).",
];

const minutesAgo = (minutes: number): string => new Date(MOCK_NOW.getTime() - minutes * 60_000).toISOString();

const cementItem: ReqItem = {
  id: mockId(18, 1),
  kind: "material",
  wo_code: null,
  item_code: "CM.01.1",
  description: "Cement",
  category: "Cement",
  spec: "OPC 43 grade",
  brand: null,
  uom: "BAG",
  quantity: 300,
  original_qty: null,
  original_uom: null,
  extra_pct: null,
  location_breakdown: null,
  remarks: null,
  confidence: 0.97,
  uncertain_fields: [],
  clarification_question: null,
  source_ref: null,
  new_code_suggestion: null,
  duplicate_of: [],
};

type Lines = Array<[string, string, number | null, number | null]>;

const form = (
  lines: Lines,
  extra: Partial<Omit<QuotationInput, "vendor_id" | "items">> = {},
): Omit<QuotationInput, "vendor_id"> => ({
  quote_date: "2026-11-16",
  validity_days: 30,
  gst_pct: 18,
  gst_included: false,
  freight: 0,
  payment_terms: "30 days from invoice",
  advance_pct: 0,
  start_days: 7,
  warranty: "12 months",
  escalation_clause: false,
  brands: [],
  remarks: null,
  ...extra,
  items: lines.map(([rfq_item_id, uom_quoted, qty_quoted, rate]) => ({ rfq_item_id, uom_quoted, qty_quoted, rate })),
});

export function seedFlow(requisitions: Requisition[], vendors: Vendor[]) {
  const vendorName = (n: number): string => vendors.find((row) => row.id === mockId(50, n))?.name ?? "Vendor";

  requisitions.push({
    id: mockId(20, 112),
    project_id: requisitions.find((row) => row.id === mockId(20, 118))?.project_id ?? mockId(1, 1),
    raised_by: mockId(2, 1),
    input_type: "text",
    original_lang: "en",
    source_file_id: null,
    status: "WO_GENERATED",
    items: [cementItem],
    revision: 1,
    confirmed_at: minutesAgo(60 * 24 * 12),
    created_at: minutesAgo(60 * 24 * 12),
  });

  const rfqOne: Rfq = {
    id: mockId(60, 1),
    requisition_id: mockId(20, 118),
    category: "Road / Civil",
    items: [
      { id: mockId(62, 1), req_item_id: mockId(17, 1), description: "Paver Block 60mm", spec: "M-30 grey, zig-zag pattern", brand: null, uom: "SQM", quantity: 650, spec_version: 1 },
      { id: mockId(62, 2), req_item_id: mockId(17, 2), description: "Precast Kerb Stone", spec: "300 x 150 x 450 mm", brand: null, uom: "NOS", quantity: 180, spec_version: 1 },
    ],
    terms: DEMO_TERMS,
    due_date: "2026-11-28",
    status: "SENT",
    vendors: [
      { vendor_id: mockId(50, 3), vendor_name: vendorName(3), status: "QUOTATION_SUBMITTED", viewed_at: minutesAgo(60 * 24 * 6) },
      { vendor_id: mockId(50, 4), vendor_name: vendorName(4), status: "QUOTATION_SUBMITTED", viewed_at: minutesAgo(60 * 24 * 5) },
      { vendor_id: mockId(50, 5), vendor_name: vendorName(5), status: "QUOTATION_SUBMITTED", viewed_at: minutesAgo(60 * 24 * 5) },
    ],
  };

  const rfqTwo: Rfq = {
    id: mockId(60, 2),
    requisition_id: mockId(20, 112),
    category: "Cement",
    items: [{ id: mockId(62, 3), req_item_id: cementItem.id, description: "Cement", spec: "OPC 43 grade", brand: null, uom: "BAG", quantity: 300, spec_version: 1 }],
    terms: DEMO_TERMS,
    due_date: "2026-11-18",
    status: "AWARDED",
    vendors: [
      { vendor_id: mockId(50, 6), vendor_name: vendorName(6), status: "AWARDED", viewed_at: minutesAgo(60 * 24 * 10) },
      { vendor_id: mockId(50, 7), vendor_name: vendorName(7), status: "NOT_AWARDED", viewed_at: minutesAgo(60 * 24 * 10) },
      { vendor_id: mockId(50, 8), vendor_name: vendorName(8), status: "NOT_AWARDED", viewed_at: minutesAgo(60 * 24 * 9) },
    ],
  };

  const [paver, kerb] = rfqOne.items;
  const cement = rfqTwo.items[0];

  const quotations: Quotation[] = [
    buildQuotation(rfqOne, mockId(50, 3), 1, form([[paver.id, "SQM", 650, 820], [kerb.id, "NOS", 180, 410]], { freight: 12000, start_days: 10, advance_pct: 10 }), mockId(61, 1), "SUBMITTED"),
    buildQuotation(rfqOne, mockId(50, 3), 2, form([[paver.id, "SQM", 650, 790], [kerb.id, "NOS", 180, 395]], { freight: 9000, start_days: 10, advance_pct: 10, quote_date: "2026-11-19", remarks: "Revised after the HOD asked for a better rate." }), mockId(61, 2), "SUBMITTED"),
    buildQuotation(rfqOne, mockId(50, 4), 1, form([[paver.id, "SQM", 650, 780], [kerb.id, "NOS", 180, 430]], { freight: 15000, payment_terms: "45 days from invoice", warranty: "24 months", start_days: 7 }), mockId(61, 3), "VERIFIED"),
    buildQuotation(rfqOne, mockId(50, 5), 1, form([[paver.id, "SQFT", 6997, 72], [kerb.id, "NOS", 180, 380]], { quote_date: "2026-11-10", validity_days: 7, freight: 8000, payment_terms: null, escalation_clause: true, start_days: 14 }), mockId(61, 4), "NEEDS_REVIEW"),
    buildQuotation(rfqTwo, mockId(50, 6), 1, form([[cement.id, "BAG", 300, 395]], { freight: 3000, start_days: 2, brands: ["Brand A"] }), mockId(61, 5), "VERIFIED"),
    buildQuotation(rfqTwo, mockId(50, 7), 1, form([[cement.id, "BAG", 300, 388]], { freight: 5500, start_days: 5, advance_pct: 25 }), mockId(61, 6), "VERIFIED"),
    buildQuotation(rfqTwo, mockId(50, 8), 1, form([[cement.id, "BAG", 300, 402]], { freight: 2500, start_days: 4 }), mockId(61, 7), "VERIFIED"),
  ];

  const evaluations: EvaluationState[] = [
    { id: mockId(68, 1), rfq_id: rfqOne.id, weights: { ...DEFAULT_WEIGHTS }, selections: null, note: null },
    {
      id: mockId(68, 2),
      rfq_id: rfqTwo.id,
      weights: { ...DEFAULT_WEIGHTS },
      selections: [{ rfq_item_id: cement.id, vendor_id: mockId(50, 6) }],
      note: "Strong delivery record and the earliest start. Landed price within 1% of the lowest.",
    },
  ];

  const cementRow = computeEvaluation({
    id: evaluations[1].id,
    rfq: rfqTwo,
    quotations: quotations.filter((row) => row.rfq_id === rfqTwo.id),
    vendors,
    weights: evaluations[1].weights,
    selections: evaluations[1].selections,
    note: evaluations[1].note,
  }).rows.find((row) => row.vendor_id === mockId(50, 6));
  const cementLine = cementRow?.line_items[0];

  const workOrders: WorkOrder[] = [
    {
      id: mockId(66, 1),
      wo_number: "VG/DEMO1/WO/26-27/001",
      requisition_id: mockId(20, 112),
      rfq_id: rfqTwo.id,
      vendor: { id: mockId(50, 6), name: vendorName(6) },
      items: [{ description: "Cement", uom: "BAG", qty: 300, rate: cementLine?.rate_in_rfq_uom ?? 395, amount: cementLine?.line_total ?? 118500 }],
      subtotal: cementRow?.subtotal_at_rfq_qty ?? 118500,
      gst: cementRow?.gst ?? 21330,
      freight: cementRow?.freight ?? 3000,
      total: cementRow?.landed_total ?? 142830,
      terms: DEMO_TERMS,
      approved_by: null,
      status: "PENDING_APPROVAL",
      created_at: minutesAgo(90),
    },
  ];

  const alternatives: Alternative[] = [
    {
      id: mockId(63, 1),
      rfq_item_id: kerb.id,
      vendor_id: mockId(50, 5),
      original_spec: kerb.spec,
      proposed_spec: "250 x 125 x 400 mm, M-30 precast",
      proposed_brand: "BrandZ Precast",
      explanation: "This mould is stocked locally, so supply starts about six days sooner. Strength grade is the same.",
      status: "PROPOSED",
      decided_at: null,
    },
  ];

  const conversations: Conversation[] = [
    { id: mockId(64, 1), rfq_id: rfqOne.id, requisition_id: rfqOne.requisition_id, vendor_id: mockId(50, 3), vendor_name: vendorName(3), last_message: "Revised quote submitted.", unread: 0, status: "open", last_activity: minutesAgo(60 * 24 * 2) },
    { id: mockId(64, 2), rfq_id: rfqOne.id, requisition_id: rfqOne.requisition_id, vendor_id: mockId(50, 4), vendor_name: vendorName(4), last_message: "We can start within 7 days of the work order.", unread: 1, status: "open", last_activity: minutesAgo(180) },
    { id: mockId(64, 3), rfq_id: rfqOne.id, requisition_id: rfqOne.requisition_id, vendor_id: mockId(50, 5), vendor_name: vendorName(5), last_message: "We have proposed an alternative kerb size. Please review it.", unread: 1, status: "open", last_activity: minutesAgo(45) },
  ];

  const msg = (
    n: number,
    conversation: Conversation,
    sender: "vendor" | "hod" | "system",
    text: string,
    ago: number,
    read: boolean,
    itemId: string | null = null,
  ): Message => ({
    id: mockId(65, n),
    conversation_id: conversation.id,
    rfq_id: conversation.rfq_id,
    requisition_id: conversation.requisition_id,
    vendor_id: conversation.vendor_id,
    sender_id: sender === "system" ? null : sender === "hod" ? mockId(3, 1) : mockId(4, Number(conversation.vendor_id.slice(-1)) + 0),
    sender_role: sender,
    type: sender === "system" ? "system" : "text",
    text,
    transcript: null,
    audio_url: null,
    rfq_item_id: itemId,
    created_at: minutesAgo(ago),
    read_at: read ? minutesAgo(ago - 1) : null,
  });

  const messages: Message[] = [
    msg(1, conversations[0], "system", "RFQ sent. Due 28 Nov 2026.", 60 * 24 * 6, true),
    msg(2, conversations[0], "vendor", "If the paver quantity is firm at 650 SQM, can we revise the rate?", 60 * 24 * 4, true, paver.id),
    msg(3, conversations[0], "hod", "Quantity is firm. Please send a revised quote with freight reduced.", 60 * 24 * 3, true),
    msg(4, conversations[0], "system", "Revision requested. Round 2 submitted.", 60 * 24 * 2, true),
    msg(5, conversations[1], "system", "RFQ sent. Due 28 Nov 2026.", 60 * 24 * 6, true),
    msg(6, conversations[1], "vendor", "We can start within 7 days of the work order.", 180, false),
    msg(7, conversations[2], "system", "RFQ sent. Due 28 Nov 2026.", 60 * 24 * 6, true),
    msg(8, conversations[2], "vendor", "We have proposed an alternative kerb size. Please review it.", 45, false, kerb.id),
  ];

  const notifications = [
    { id: mockId(67, 1), type: "alternative_proposed", ref_type: "rfq", ref_id: rfqOne.id, title: `${vendorName(5)} proposed an alternative for Precast Kerb Stone`, created_at: minutesAgo(45), read_at: null, audience: "hod" as const },
    { id: mockId(67, 2), type: "quotation_submitted", ref_type: "rfq", ref_id: rfqOne.id, title: `${vendorName(4)} submitted a quotation`, created_at: minutesAgo(180), read_at: null, audience: "hod" as const },
    { id: mockId(67, 3), type: "wo_approval_requested", ref_type: "work_order", ref_id: workOrders[0].id, title: `Work Order ${workOrders[0].wo_number} needs your approval`, created_at: minutesAgo(90), read_at: null, audience: "management" as const },
  ];

  return { rfqs: [rfqOne, rfqTwo], quotations, evaluations, alternatives, conversations, messages, workOrders, notifications };
}
