import { z } from 'zod';

import { RoleSchema } from './schemas';

// Vendor side of docs/API_CONTRACT.md "Types": RFQ, chat, alternative, quotation, work order.
// Change only together with the contract and web/src/lib/api/schemas-flow.ts.

const id = z.uuid();
const timestamp = z.string().min(1);

export const RfqItemSchema = z.object({
  id,
  req_item_id: id,
  description: z.string(),
  spec: z.string().nullable(),
  brand: z.string().nullable(),
  uom: z.string(),
  quantity: z.number(),
  spec_version: z.number().int(),
});

export const RfqVendorStatusSchema = z.enum([
  'RFQ_SENT',
  'RFQ_VIEWED',
  'VENDOR_RESPONDED',
  'ALTERNATIVE_PROPOSED',
  'ALTERNATIVE_APPROVED',
  'ALTERNATIVE_REJECTED',
  'QUOTATION_SUBMITTED',
  'REVISION_REQUESTED',
  'AWARDED',
  'NOT_AWARDED',
]);

export const RfqVendorSchema = z.object({
  vendor_id: id,
  vendor_name: z.string(),
  status: RfqVendorStatusSchema,
  viewed_at: timestamp.nullable(),
});

export const RfqSchema = z.object({
  id,
  requisition_id: id,
  category: z.string(),
  items: z.array(RfqItemSchema),
  terms: z.array(z.string()),
  due_date: z.string(),
  status: z.string(),
  vendors: z.array(RfqVendorSchema),
});

export const ConversationSchema = z.object({
  id,
  rfq_id: id,
  requisition_id: id,
  vendor_id: id,
  vendor_name: z.string(),
  last_message: z.string().nullable(),
  unread: z.number().int(),
  status: z.string(),
  last_activity: timestamp,
});

export const MessageSchema = z.object({
  id,
  conversation_id: id,
  rfq_id: id,
  requisition_id: id,
  vendor_id: id,
  sender_id: id.nullable(),
  sender_role: RoleSchema.or(z.literal('system')),
  type: z.enum(['text', 'voice', 'system']),
  text: z.string().nullable(),
  transcript: z.string().nullable(),
  audio_url: z.string().nullable(),
  rfq_item_id: id.nullable(),
  created_at: timestamp,
  read_at: timestamp.nullable(),
});

export const AlternativeStatusSchema = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'INFO_REQUESTED']);

export const AlternativeSchema = z.object({
  id,
  rfq_item_id: id,
  vendor_id: id,
  original_spec: z.string().nullable(),
  proposed_spec: z.string(),
  proposed_brand: z.string().nullable(),
  explanation: z.string(),
  status: AlternativeStatusSchema,
  decided_at: timestamp.nullable(),
});

export const QuoteItemSchema = z.object({
  rfq_item_id: id.nullable(),
  description: z.string(),
  uom_quoted: z.string().nullable(),
  qty_quoted: z.number().nullable(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
  rate_in_rfq_uom: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  raw: z.unknown(),
});

export const QuotationSchema = z.object({
  id,
  rfq_id: id,
  vendor_id: id,
  round: z.number().int().min(1),
  source: z.literal('app_form'),
  status: z.string(),
  quote_date: z.string().nullable(),
  validity_days: z.number().nullable(),
  expired: z.boolean().nullable(),
  gst_pct: z.number().nullable(),
  gst_included: z.boolean().nullable(),
  freight: z.number().nullable(),
  payment_terms: z.string().nullable(),
  advance_pct: z.number().nullable(),
  start_days: z.number().nullable(),
  warranty: z.string().nullable(),
  escalation_clause: z.boolean().nullable(),
  brands: z.array(z.string()),
  items: z.array(QuoteItemSchema),
  confidence: z.number().min(0).max(1),
  flags: z.array(z.string()),
  remarks: z.string().nullable(),
});

export const WorkOrderStatusSchema = z.enum(['GENERATED', 'PENDING_APPROVAL', 'SENT', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED']);

export const WorkOrderSchema = z.object({
  id,
  wo_number: z.string(),
  requisition_id: id,
  rfq_id: id,
  vendor: z.object({ id, name: z.string() }),
  items: z.array(z.object({ description: z.string(), uom: z.string(), qty: z.number(), rate: z.number(), amount: z.number() })),
  subtotal: z.number(),
  gst: z.number(),
  freight: z.number(),
  total: z.number(),
  terms: z.array(z.string()),
  approved_by: z.string().nullable(),
  status: WorkOrderStatusSchema,
  created_at: timestamp,
});

// Request bodies

export const QuotationInputSchema = z.object({
  quote_date: z.string().nullable(),
  validity_days: z.number().int().min(1, 'Validity must be at least 1 day').nullable(),
  gst_pct: z.number().min(0).max(100, 'GST cannot exceed 100%').nullable(),
  gst_included: z.boolean().nullable(),
  freight: z.number().min(0).nullable(),
  payment_terms: z.string().trim().nullable(),
  advance_pct: z.number().min(0).max(100, 'Advance cannot exceed 100%').nullable(),
  start_days: z.number().int().min(0).nullable(),
  warranty: z.string().trim().nullable(),
  escalation_clause: z.boolean().nullable(),
  brands: z.array(z.string()),
  remarks: z.string().trim().nullable(),
  items: z
    .array(
      z.object({
        rfq_item_id: id,
        uom_quoted: z.string().trim().min(1, 'Choose a unit'),
        qty_quoted: z.number().min(0).nullable(),
        rate: z.number().min(0).nullable(),
      }),
    )
    .min(1),
});

export const AlternativeInputSchema = z.object({
  rfq_item_id: id,
  proposed_spec: z.string().trim().min(3, 'Describe the alternative you propose').max(1000),
  proposed_brand: z.string().trim().max(120).optional(),
  explanation: z.string().trim().min(5, 'Say why this alternative suits the work').max(2000),
});

export const MessageInputSchema = z.object({ text: z.string().trim().min(1).max(2000), rfq_item_id: id.optional() });

export type RfqItem = z.infer<typeof RfqItemSchema>;
export type RfqVendor = z.infer<typeof RfqVendorSchema>;
export type RfqVendorStatus = z.infer<typeof RfqVendorStatusSchema>;
export type Rfq = z.infer<typeof RfqSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;
export type QuoteItem = z.infer<typeof QuoteItemSchema>;
export type Quotation = z.infer<typeof QuotationSchema>;
export type WorkOrder = z.infer<typeof WorkOrderSchema>;
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;
export type QuotationInput = z.infer<typeof QuotationInputSchema>;
export type AlternativeInput = z.infer<typeof AlternativeInputSchema>;
export type MessageInput = z.infer<typeof MessageInputSchema>;
