import { getUserId } from '@/lib/identity';

import { ApiError } from '../errors';
import type { UploadFile } from '../endpoints';
import type {
  Alternative,
  AlternativeInput,
  AlternativeReplyInput,
  Conversation,
  Message,
  Quotation,
  QuotationInput,
  Rfq,
  RfqVendorStatus,
  WorkOrder,
} from '../schemas-vendor';
import { MOCK_USERS, uid } from './fixtures';

// In-memory stand-in for Phase 5 and 6. It resets when the app reloads and shares nothing with the HOD web mock.
// Vendor isolation is simulated here the way the server must do it: a vendor only ever receives its own rows.
// The mock cannot hear: voice messages keep the recording but carry no transcript.

const LATENCY_MS = 350;

export const VENDOR_ONE = uid(50, 3);
export const VENDOR_TWO = uid(50, 4);
export const VENDOR_THREE = uid(50, 5);

const vendorName = (vendorId: string): string =>
  MOCK_USERS.find((user) => user.vendor_id === vendorId)?.name ?? 'Vendor';

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const daysFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const DEMO_TERMS = [
  'Rates are firm for the validity period (demo term).',
  'Payment as per the agreed schedule (demo term).',
  'Delivery to the project site (demo term).',
  'GST as applicable (demo term).',
  'Defects liability as per the work order (demo term).',
  'Vinayak may reject non-conforming supply (demo term).',
];

const rfqRoad: Rfq = {
  id: uid(91, 1),
  requisition_id: uid(99, 1),
  category: 'Road / Civil',
  items: [
    { id: uid(92, 1), req_item_id: uid(98, 1), description: 'Paver Block 60mm', spec: 'M-30 grey, zig-zag pattern', brand: null, uom: 'SQM', quantity: 650, spec_version: 1 },
    { id: uid(92, 2), req_item_id: uid(98, 2), description: 'Precast Kerb Stone', spec: '300 x 150 x 450 mm', brand: null, uom: 'NOS', quantity: 180, spec_version: 1 },
  ],
  terms: DEMO_TERMS,
  due_date: daysFromNow(7),
  status: 'SENT',
  vendors: [
    { vendor_id: VENDOR_ONE, vendor_name: vendorName(VENDOR_ONE), status: 'REVISION_REQUESTED', viewed_at: minutesAgo(60 * 24 * 5) },
    { vendor_id: VENDOR_TWO, vendor_name: vendorName(VENDOR_TWO), status: 'RFQ_VIEWED', viewed_at: minutesAgo(60 * 24 * 2) },
    { vendor_id: VENDOR_THREE, vendor_name: vendorName(VENDOR_THREE), status: 'ALTERNATIVE_PROPOSED', viewed_at: minutesAgo(60 * 24 * 3) },
  ],
};

const rfqWaterproofing: Rfq = {
  id: uid(91, 2),
  requisition_id: uid(99, 2),
  category: 'Waterproofing',
  items: [
    { id: uid(92, 3), req_item_id: uid(98, 3), description: 'Cementitious waterproof coating, toilets', spec: 'Two coats, 2 mm total', brand: null, uom: 'SQFT', quantity: 1240, spec_version: 1 },
    { id: uid(92, 4), req_item_id: uid(98, 4), description: 'Integral waterproofing admixture, powder', spec: null, brand: null, uom: 'KG', quantity: 150, spec_version: 1 },
  ],
  terms: DEMO_TERMS,
  due_date: daysFromNow(11),
  status: 'SENT',
  vendors: [VENDOR_ONE, VENDOR_TWO, VENDOR_THREE].map((vendorId) => ({
    vendor_id: vendorId,
    vendor_name: vendorName(vendorId),
    status: 'RFQ_SENT' as const,
    viewed_at: null,
  })),
};

const rfqCement: Rfq = {
  id: uid(91, 3),
  requisition_id: uid(99, 3),
  category: 'Cement',
  items: [{ id: uid(92, 5), req_item_id: uid(98, 5), description: 'Cement', spec: 'OPC 43 grade', brand: null, uom: 'BAG', quantity: 300, spec_version: 1 }],
  terms: DEMO_TERMS,
  due_date: daysFromNow(-3),
  status: 'AWARDED',
  vendors: [
    { vendor_id: VENDOR_ONE, vendor_name: vendorName(VENDOR_ONE), status: 'AWARDED', viewed_at: minutesAgo(60 * 24 * 10) },
    { vendor_id: VENDOR_TWO, vendor_name: vendorName(VENDOR_TWO), status: 'NOT_AWARDED', viewed_at: minutesAgo(60 * 24 * 10) },
    { vendor_id: VENDOR_THREE, vendor_name: vendorName(VENDOR_THREE), status: 'NOT_AWARDED', viewed_at: minutesAgo(60 * 24 * 9) },
  ],
};

type QuoteLine = [itemId: string, uom: string, qty: number | null, rate: number | null];

function quoteForm(lines: QuoteLine[], extra: Partial<Omit<QuotationInput, 'items'>> = {}): QuotationInput {
  return {
    quote_date: daysFromNow(-4),
    validity_days: 30,
    gst_pct: 18,
    gst_included: false,
    freight: 0,
    payment_terms: '30 days from invoice',
    advance_pct: 0,
    start_days: 7,
    warranty: '12 months',
    escalation_clause: false,
    brands: [],
    remarks: null,
    ...extra,
    items: lines.map(([rfq_item_id, uom_quoted, qty_quoted, rate]) => ({ rfq_item_id, uom_quoted, qty_quoted, rate })),
  };
}

// Mirrors the server's flagging closely enough for the form to show what will be raised. The server is the source of truth.
function flagsFor(rfq: Rfq, input: QuotationInput): string[] {
  const flags = new Set<string>();
  for (const line of input.items) {
    const wanted = rfq.items.find((candidate) => candidate.id === line.rfq_item_id);
    if (!wanted) continue;
    if (line.uom_quoted.toUpperCase() !== wanted.uom.toUpperCase()) flags.add('unit_mismatch');
    if (line.qty_quoted !== null && line.qty_quoted !== wanted.quantity) flags.add('qty_differs_from_rfq');
  }
  if (input.quote_date === null) flags.add('undated');
  if (input.quote_date !== null && input.validity_days !== null) {
    const expires = new Date(input.quote_date).getTime() + input.validity_days * 86_400_000;
    if (expires < Date.now()) flags.add('expired_offer');
  }
  if (input.payment_terms === null || input.payment_terms === '') flags.add('missing_terms');
  if (input.escalation_clause === true) flags.add('escalation_clause');
  return [...flags];
}

function buildQuotation(rfq: Rfq, vendorId: string, round: number, input: QuotationInput, id: string): Quotation {
  const items = input.items.map((line) => {
    const wanted = rfq.items.find((candidate) => candidate.id === line.rfq_item_id);
    const sameUnit = wanted !== undefined && line.uom_quoted.toUpperCase() === wanted.uom.toUpperCase();
    return {
      rfq_item_id: line.rfq_item_id,
      description: wanted?.description ?? 'Item',
      uom_quoted: line.uom_quoted,
      qty_quoted: line.qty_quoted,
      rate: line.rate,
      amount: line.qty_quoted !== null && line.rate !== null ? Math.round(line.qty_quoted * line.rate * 100) / 100 : null,
      rate_in_rfq_uom: sameUnit ? line.rate : null,
      confidence: 1,
      raw: null,
    };
  });
  const flags = flagsFor(rfq, input);
  const expired = flags.includes('expired_offer');
  return {
    id,
    rfq_id: rfq.id,
    vendor_id: vendorId,
    round,
    source: 'app_form',
    status: flags.length > 0 ? 'NEEDS_REVIEW' : 'SUBMITTED',
    quote_date: input.quote_date,
    validity_days: input.validity_days,
    expired: input.quote_date === null || input.validity_days === null ? null : expired,
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
    flags,
    remarks: input.remarks,
  };
}

const [paver, kerb] = rfqRoad.items;
const [coating, admixture] = rfqWaterproofing.items;
const [cement] = rfqCement.items;

const store = {
  rfqs: [rfqRoad, rfqWaterproofing, rfqCement],
  quotations: [
    buildQuotation(rfqRoad, VENDOR_ONE, 1, quoteForm([[paver.id, 'SQM', 650, 820], [kerb.id, 'NOS', 180, 410]], { freight: 12000, start_days: 10, advance_pct: 10 }), uid(96, 1)),
    buildQuotation(rfqCement, VENDOR_ONE, 1, quoteForm([[cement.id, 'BAG', 300, 395]], { freight: 3000, start_days: 2, brands: ['Brand A'], quote_date: daysFromNow(-14) }), uid(96, 2)),
    buildQuotation(rfqCement, VENDOR_TWO, 1, quoteForm([[cement.id, 'BAG', 300, 388]], { freight: 5500, start_days: 5, advance_pct: 25, quote_date: daysFromNow(-14) }), uid(96, 3)),
  ] as Quotation[],
  alternatives: [
    {
      id: uid(93, 1),
      rfq_item_id: kerb.id,
      vendor_id: VENDOR_THREE,
      original_spec: kerb.spec,
      proposed_spec: '250 x 125 x 400 mm, M-30 precast',
      proposed_brand: 'BrandZ Precast',
      explanation: 'This mould is stocked locally, so supply starts about six days sooner. Strength grade is the same.',
      status: 'PROPOSED',
      decided_at: null,
    },
  ] as Alternative[],
  conversations: [] as Conversation[],
  messages: [] as Message[],
  workOrders: [
    {
      id: uid(97, 1),
      wo_number: 'VG/DEMO1/WO/26-27/001',
      requisition_id: rfqCement.requisition_id,
      rfq_id: rfqCement.id,
      vendor: { id: VENDOR_ONE, name: vendorName(VENDOR_ONE) },
      items: [{ description: 'Cement', uom: 'BAG', qty: 300, rate: 395, amount: 118_500 }],
      subtotal: 118_500,
      gst: 21_330,
      freight: 3_000,
      total: 142_830,
      terms: DEMO_TERMS,
      approved_by: 'Management Approver (demo)',
      status: 'SENT',
      created_at: minutesAgo(60 * 5),
    },
    {
      id: uid(97, 2),
      wo_number: 'VG/DEMO1/WO/26-27/002',
      requisition_id: rfqRoad.requisition_id,
      rfq_id: rfqRoad.id,
      vendor: { id: VENDOR_TWO, name: vendorName(VENDOR_TWO) },
      items: [{ description: 'Paver Block 60mm', uom: 'SQM', qty: 650, rate: 780, amount: 507_000 }],
      subtotal: 507_000,
      gst: 91_260,
      freight: 15_000,
      total: 613_260,
      terms: DEMO_TERMS,
      approved_by: null,
      status: 'PENDING_APPROVAL',
      created_at: minutesAgo(90),
    },
  ] as WorkOrder[],
  counter: 0,
};

function nextId(group: number): string {
  store.counter += 1;
  return uid(group, 500_000 + store.counter);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentVendorId(): string {
  const userId = getUserId();
  const user = MOCK_USERS.find((candidate) => candidate.id === userId);
  if (!user) throw new ApiError(401, 'unauthorized', 'Unknown X-User-Id.');
  if (user.role !== 'vendor' || user.vendor_id === null) throw new ApiError(403, 'forbidden', 'Only vendors can use this.');
  return user.vendor_id;
}

function ownEntry(rfq: Rfq, vendorId: string) {
  return rfq.vendors.find((entry) => entry.vendor_id === vendorId) ?? null;
}

function ownRfq(rfqId: string, vendorId: string): Rfq {
  const rfq = store.rfqs.find((candidate) => candidate.id === rfqId);
  if (!rfq || !ownEntry(rfq, vendorId)) throw new ApiError(404, 'not_found', 'RFQ not found.');
  return rfq;
}

function scoped(rfq: Rfq, vendorId: string): Rfq {
  const own = ownEntry(rfq, vendorId);
  return clone({ ...rfq, vendors: own ? [own] : [] });
}

function setVendorStatus(rfq: Rfq, vendorId: string, status: RfqVendorStatus): void {
  rfq.vendors = rfq.vendors.map((entry) => (entry.vendor_id === vendorId ? { ...entry, status } : entry));
}

function ensureConversation(rfq: Rfq, vendorId: string): Conversation {
  const existing = store.conversations.find((candidate) => candidate.rfq_id === rfq.id && candidate.vendor_id === vendorId);
  if (existing) return existing;
  const conversation: Conversation = {
    id: nextId(94),
    rfq_id: rfq.id,
    requisition_id: rfq.requisition_id,
    vendor_id: vendorId,
    vendor_name: vendorName(vendorId),
    last_message: `RFQ sent. Due ${rfq.due_date}.`,
    unread: 0,
    status: 'open',
    last_activity: minutesAgo(60 * 24 * 5),
  };
  store.conversations.push(conversation);
  store.messages.push(systemMessage(conversation, `RFQ sent. Due ${rfq.due_date}.`, 60 * 24 * 5));
  return conversation;
}

function systemMessage(conversation: Conversation, text: string, ago = 0): Message {
  return {
    id: nextId(95),
    conversation_id: conversation.id,
    rfq_id: conversation.rfq_id,
    requisition_id: conversation.requisition_id,
    vendor_id: conversation.vendor_id,
    sender_id: null,
    sender_role: 'system',
    type: 'system',
    text,
    transcript: null,
    audio_url: null,
    rfq_item_id: null,
    created_at: minutesAgo(ago),
    read_at: minutesAgo(ago),
  };
}

function seedChat(): void {
  for (const rfq of store.rfqs) for (const entry of rfq.vendors) ensureConversation(rfq, entry.vendor_id);

  const talk = (vendorId: string, rfqId: string, sender: 'vendor' | 'hod', text: string, ago: number, unread: boolean, itemId: string | null = null) => {
    const conversation = store.conversations.find((candidate) => candidate.rfq_id === rfqId && candidate.vendor_id === vendorId);
    if (!conversation) return;
    const hodId = uid(3, 1);
    const vendorUser = MOCK_USERS.find((user) => user.vendor_id === vendorId);
    store.messages.push({
      id: nextId(95),
      conversation_id: conversation.id,
      rfq_id: conversation.rfq_id,
      requisition_id: conversation.requisition_id,
      vendor_id: vendorId,
      sender_id: sender === 'hod' ? hodId : (vendorUser?.id ?? null),
      sender_role: sender === 'hod' ? 'hod' : 'vendor',
      type: 'text',
      text,
      transcript: null,
      audio_url: null,
      rfq_item_id: itemId,
      created_at: minutesAgo(ago),
      read_at: unread ? null : minutesAgo(ago),
    });
    conversation.last_message = text;
    conversation.last_activity = minutesAgo(ago);
    if (unread) conversation.unread += 1;
  };

  talk(VENDOR_ONE, rfqRoad.id, 'vendor', 'If the paver quantity is firm at 650 SQM, can we revise the rate?', 60 * 24 * 4, false, paver.id);
  talk(VENDOR_ONE, rfqRoad.id, 'hod', 'Quantity is firm. Please send a revised quote with freight reduced.', 60 * 24 * 3, false);
  talk(VENDOR_ONE, rfqRoad.id, 'hod', 'Revision requested: please resubmit with a lower freight and your best paver rate.', 180, true);
  talk(VENDOR_TWO, rfqRoad.id, 'hod', 'Please confirm the start date once you have reviewed the RFQ.', 240, true);
  talk(VENDOR_THREE, rfqRoad.id, 'vendor', 'We have proposed an alternative kerb size. Please review it.', 45, false, kerb.id);
  talk(VENDOR_THREE, rfqWaterproofing.id, 'hod', 'Please confirm admixture brand options when you quote.', 30, true, admixture.id);
  void coating;
}

seedChat();

function ownConversation(conversationId: string, vendorId: string): Conversation {
  const conversation = store.conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation || conversation.vendor_id !== vendorId) throw new ApiError(404, 'not_found', 'Conversation not found.');
  return conversation;
}

const VISIBLE_WO: ReadonlySet<WorkOrder['status']> = new Set<WorkOrder['status']>(['SENT', 'ACKNOWLEDGED', 'COMPLETED']);

export const vendorMocks = {
  async listRfqs(): Promise<Rfq[]> {
    await delay();
    const vendorId = currentVendorId();
    return store.rfqs.filter((rfq) => ownEntry(rfq, vendorId)).map((rfq) => scoped(rfq, vendorId));
  },

  // Opening an RFQ for the first time marks it viewed, as the server does.
  async getRfq(id: string): Promise<Rfq> {
    await delay();
    const vendorId = currentVendorId();
    const rfq = ownRfq(id, vendorId);
    const entry = ownEntry(rfq, vendorId);
    if (entry && entry.status === 'RFQ_SENT') {
      rfq.vendors = rfq.vendors.map((candidate) =>
        candidate.vendor_id === vendorId ? { ...candidate, status: 'RFQ_VIEWED', viewed_at: new Date().toISOString() } : candidate,
      );
    }
    return scoped(rfq, vendorId);
  },

  async listConversations(): Promise<Conversation[]> {
    await delay(250);
    const vendorId = currentVendorId();
    return clone(
      store.conversations
        .filter((conversation) => conversation.vendor_id === vendorId)
        .sort((left, right) => right.last_activity.localeCompare(left.last_activity)),
    );
  },

  async listMessages(conversationId: string): Promise<Message[]> {
    await delay(200);
    const vendorId = currentVendorId();
    const conversation = ownConversation(conversationId, vendorId);
    const now = new Date().toISOString();
    store.messages = store.messages.map((message) =>
      message.conversation_id === conversationId && message.sender_role !== 'vendor' && message.read_at === null
        ? { ...message, read_at: now }
        : message,
    );
    conversation.unread = 0;
    return clone(
      store.messages
        .filter((message) => message.conversation_id === conversationId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at)),
    );
  },

  async sendMessage(conversationId: string, input: { text: string | null; rfqItemId: string | null; audio: UploadFile | null }): Promise<Message> {
    await delay(500);
    const vendorId = currentVendorId();
    const conversation = ownConversation(conversationId, vendorId);
    const userId = getUserId();
    const isVoice = input.audio !== null;
    if (!isVoice && (input.text === null || input.text.trim() === '')) throw new ApiError(422, 'validation_error', 'Write a message first.');
    const message: Message = {
      id: nextId(95),
      conversation_id: conversationId,
      rfq_id: conversation.rfq_id,
      requisition_id: conversation.requisition_id,
      vendor_id: vendorId,
      sender_id: userId,
      sender_role: 'vendor',
      type: isVoice ? 'voice' : 'text',
      text: isVoice ? null : (input.text?.trim() ?? null),
      transcript: null,
      audio_url: input.audio?.uri ?? null,
      rfq_item_id: input.rfqItemId,
      created_at: new Date().toISOString(),
      read_at: null,
    };
    store.messages.push(message);
    conversation.last_message = isVoice ? 'Voice message' : message.text;
    conversation.last_activity = message.created_at;
    const rfq = store.rfqs.find((candidate) => candidate.id === conversation.rfq_id);
    const entry = rfq ? ownEntry(rfq, vendorId) : null;
    if (rfq && entry && (entry.status === 'RFQ_SENT' || entry.status === 'RFQ_VIEWED')) setVendorStatus(rfq, vendorId, 'VENDOR_RESPONDED');
    return clone(message);
  },

  async proposeAlternative(input: AlternativeInput): Promise<Alternative> {
    await delay(700);
    const vendorId = currentVendorId();
    const rfq = store.rfqs.find((candidate) => candidate.items.some((line) => line.id === input.rfq_item_id) && ownEntry(candidate, vendorId));
    const line = rfq?.items.find((candidate) => candidate.id === input.rfq_item_id);
    if (!rfq || !line) throw new ApiError(404, 'not_found', 'RFQ item not found.');
    const entry = ownEntry(rfq, vendorId);
    if (entry?.status === 'AWARDED' || entry?.status === 'NOT_AWARDED') throw new ApiError(409, 'conflict', 'This RFQ is closed.');
    const alternative: Alternative = {
      id: nextId(93),
      rfq_item_id: line.id,
      vendor_id: vendorId,
      original_spec: line.spec,
      proposed_spec: input.proposed_spec,
      proposed_brand: input.proposed_brand ? input.proposed_brand : null,
      explanation: input.explanation,
      status: 'PROPOSED',
      decided_at: null,
    };
    store.alternatives.push(alternative);
    setVendorStatus(rfq, vendorId, 'ALTERNATIVE_PROPOSED');
    const conversation = ensureConversation(rfq, vendorId);
    store.messages.push(systemMessage(conversation, `Alternative proposed for ${line.description}.`));
    conversation.last_message = `Alternative proposed for ${line.description}.`;
    conversation.last_activity = new Date().toISOString();
    return clone(alternative);
  },

  async replyAlternative(id: string, input: AlternativeReplyInput): Promise<Alternative> {
    await delay(600);
    const vendorId = currentVendorId();
    const alternative = store.alternatives.find((candidate) => candidate.id === id && candidate.vendor_id === vendorId);
    if (!alternative) throw new ApiError(404, 'not_found', 'Alternative not found.');
    if (alternative.status !== 'INFO_REQUESTED') throw new ApiError(409, 'invalid_transition', 'The HOD has not asked for more information on this alternative.');
    if (input.note.trim() === '') throw new ApiError(422, 'validation_error', 'Write your answer for the HOD.');
    const spec = input.proposed_spec?.trim();
    alternative.status = 'PROPOSED';
    if (spec) alternative.proposed_spec = spec;
    return clone(alternative);
  },

  async listQuotations(rfqId: string): Promise<Quotation[]> {
    await delay();
    const vendorId = currentVendorId();
    ownRfq(rfqId, vendorId);
    return clone(
      store.quotations
        .filter((quotation) => quotation.rfq_id === rfqId && quotation.vendor_id === vendorId)
        .sort((left, right) => left.round - right.round),
    );
  },

  async submitQuotation(rfqId: string, input: QuotationInput): Promise<Quotation> {
    await delay(900);
    const vendorId = currentVendorId();
    const rfq = ownRfq(rfqId, vendorId);
    const entry = ownEntry(rfq, vendorId);
    if (entry?.status === 'AWARDED' || entry?.status === 'NOT_AWARDED') {
      throw new ApiError(409, 'conflict', 'Vinayak has already selected a vendor for this RFQ. A new quotation cannot be submitted.');
    }
    const previous = store.quotations.filter((quotation) => quotation.rfq_id === rfqId && quotation.vendor_id === vendorId);
    const round = previous.reduce((highest, quotation) => Math.max(highest, quotation.round), 0) + 1;
    const quotation = buildQuotation(rfq, vendorId, round, input, nextId(96));
    store.quotations.push(quotation);
    setVendorStatus(rfq, vendorId, 'QUOTATION_SUBMITTED');
    const conversation = ensureConversation(rfq, vendorId);
    const note = round === 1 ? 'Quotation submitted.' : `Revised quotation submitted (round ${round}).`;
    store.messages.push(systemMessage(conversation, note));
    conversation.last_message = note;
    conversation.last_activity = new Date().toISOString();
    return clone(quotation);
  },

  async listWorkOrders(): Promise<WorkOrder[]> {
    await delay();
    const vendorId = currentVendorId();
    return clone(
      store.workOrders
        .filter((order) => order.vendor.id === vendorId && VISIBLE_WO.has(order.status))
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    );
  },

  async acknowledgeWorkOrder(id: string): Promise<WorkOrder> {
    await delay(600);
    const vendorId = currentVendorId();
    const order = store.workOrders.find((candidate) => candidate.id === id);
    if (!order || order.vendor.id !== vendorId || !VISIBLE_WO.has(order.status)) throw new ApiError(404, 'not_found', 'Work order not found.');
    if (order.status !== 'SENT') throw new ApiError(409, 'invalid_transition', 'Only an issued Work Order can be acknowledged.');
    order.status = 'ACKNOWLEDGED';
    return clone(order);
  },

  async getWorkOrder(id: string): Promise<WorkOrder> {
    await delay();
    const vendorId = currentVendorId();
    const order = store.workOrders.find((candidate) => candidate.id === id);
    if (!order || order.vendor.id !== vendorId || !VISIBLE_WO.has(order.status)) throw new ApiError(404, 'not_found', 'Work order not found.');
    return clone(order);
  },
};
