import { z } from 'zod';

// Mirrors docs/API_CONTRACT.md "Types" for the engineer and vendor app.
// Change only together with the contract and web/src/lib/api/schemas.ts.

const id = z.uuid();
const timestamp = z.string().min(1);

export const RoleSchema = z.enum(['site_engineer', 'hod', 'management', 'vendor']);

export const UserSchema = z.object({
  id,
  name: z.string(),
  role: RoleSchema,
  vendor_id: id.nullable(),
  project_ids: z.array(id),
});

export const ProjectSchema = z.object({ id, code: z.string(), name: z.string() });

export const UomSchema = z.enum(['SQFT', 'SQM', 'RMT', 'CUM', 'CFT', 'NOS', 'BAG', 'KG', 'MT', 'LTR']);

export const RequisitionStatusSchema = z.enum([
  'DRAFT',
  'PROCESSING',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CLARIFICATION_REQUIRED',
  'RFQ_FLOATED',
  'UNDER_EVALUATION',
  'VENDOR_SELECTED',
  'WO_GENERATED',
  'ORDER_PLACED',
  'COMPLETED',
  'CANCELLED',
]);

export const InputTypeSchema = z.enum(['voice', 'image', 'pdf', 'csv', 'xlsx', 'docx', 'txt', 'text']);
export const LangSchema = z.enum(['bn', 'hi', 'en']);

export const DuplicateSchema = z.object({ code: z.string(), description: z.string(), reason: z.string() });

export const ReqItemSchema = z.object({
  id,
  kind: z.enum(['work', 'material']),
  wo_code: z.string().nullable(),
  item_code: z.string().nullable(),
  description: z.string(),
  category: z.string().nullable(),
  spec: z.string().nullable(),
  brand: z.string().nullable(),
  uom: UomSchema.nullable(),
  quantity: z.number().nullable(),
  original_qty: z.number().nullable(),
  original_uom: z.string().nullable(),
  extra_pct: z.number().nullable(),
  location_breakdown: z.record(z.string(), z.unknown()).nullable(),
  remarks: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  uncertain_fields: z.array(z.string()),
  clarification_question: z.string().nullable(),
  source_ref: z.string().nullable(),
  new_code_suggestion: z.string().nullable(),
  duplicate_of: z.array(DuplicateSchema),
});

export const RequisitionSchema = z.object({
  id,
  project_id: id,
  raised_by: id,
  input_type: InputTypeSchema,
  original_lang: LangSchema,
  source_file_id: id.nullable(),
  status: RequisitionStatusSchema,
  items: z.array(ReqItemSchema),
  revision: z.number().int(),
  confirmed_at: timestamp.nullable(),
  created_at: timestamp,
});

export const RevisionSchema = z.object({
  version: z.number().int(),
  actor: z.string(),
  change_note: z.string(),
  items: z.array(ReqItemSchema),
  created_at: timestamp,
});

export const IngestJobSchema = z.object({
  id,
  status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
  step: z.enum(['validate', 'detect', 'extract', 'ocr', 'stt', 'lang', 'llm', 'normalise', 'done']),
  detected_lang: LangSchema.nullable(),
  error: z.string().nullable(),
  requisition_id: id.nullable(),
});

export const ReadbackSchema = z.object({ text: z.string(), lang: LangSchema, audio_url: z.string().nullable() });

export const NotificationSchema = z.object({
  id,
  type: z.string(),
  ref_type: z.string().nullable(),
  ref_id: id.nullable(),
  title: z.string(),
  created_at: timestamp,
  read_at: timestamp.nullable(),
});

export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

// Request bodies
export const TextRequisitionInputSchema = z.object({
  project_id: id,
  text: z.string().trim().min(3, 'Paste or type the requirement').max(20_000),
  lang: LangSchema.optional(),
});

export const CorrectionInputSchema = z.object({
  text: z.string().trim().min(2, 'Say what needs to change').max(2_000),
});

export type Role = z.infer<typeof RoleSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Uom = z.infer<typeof UomSchema>;
export type RequisitionStatus = z.infer<typeof RequisitionStatusSchema>;
export type InputType = z.infer<typeof InputTypeSchema>;
export type Lang = z.infer<typeof LangSchema>;
export type ReqItem = z.infer<typeof ReqItemSchema>;
export type Requisition = z.infer<typeof RequisitionSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type IngestJob = z.infer<typeof IngestJobSchema>;
export type Readback = z.infer<typeof ReadbackSchema>;
export type AppNotification = z.infer<typeof NotificationSchema>;
export type TextRequisitionInput = z.infer<typeof TextRequisitionInputSchema>;
export type CorrectionInput = z.infer<typeof CorrectionInputSchema>;
