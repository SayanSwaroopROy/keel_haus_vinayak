import { z } from "zod";

// Mirrors docs/API_CONTRACT.md "Types". Change only together with the contract.

const id = z.uuid();
const timestamp = z.string().min(1);

export const RoleSchema = z.enum(["site_engineer", "hod", "management", "vendor"]);

export const UserSchema = z.object({
  id,
  name: z.string(),
  role: RoleSchema,
  vendor_id: id.nullable(),
  project_ids: z.array(id),
});

export const ProjectSchema = z.object({ id, code: z.string(), name: z.string() });

export const UomSchema = z.enum(["SQFT", "SQM", "RMT", "CUM", "CFT", "NOS", "BAG", "KG", "MT", "LTR"]);

export const RequisitionStatusSchema = z.enum([
  "DRAFT",
  "PROCESSING",
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "SUBMITTED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CLARIFICATION_REQUIRED",
  "RFQ_FLOATED",
  "UNDER_EVALUATION",
  "VENDOR_SELECTED",
  "WO_GENERATED",
  "ORDER_PLACED",
  "COMPLETED",
  "CANCELLED",
]);

export const InputTypeSchema = z.enum(["voice", "image", "pdf", "csv", "xlsx", "docx", "txt", "text"]);
export const LangSchema = z.enum(["bn", "hi", "en"]);

export const DuplicateSchema = z.object({ code: z.string(), description: z.string(), reason: z.string() });

export const ReqItemSchema = z.object({
  id,
  kind: z.enum(["work", "material"]),
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
  actor: z.enum(["ai", "user"]),
  change_note: z.string(),
  items: z.array(ReqItemSchema),
  created_at: timestamp,
});

export const CodeMatchSchema = z.object({ code: z.string(), description: z.string(), score: z.number() });

export const MatchCodesResponseSchema = z.object({
  items: z.array(
    z.object({
      item_id: id,
      matches: z.array(CodeMatchSchema),
      duplicates: z.array(DuplicateSchema),
      new_code_suggestion: z.string().nullable(),
    }),
  ),
});

export const StockRowSchema = z.object({
  req_item_id: id,
  material: z.string(),
  uom: z.string(),
  requested: z.number(),
  physical: z.number(),
  reserved: z.number(),
  available: z.number(),
  to_procure: z.number(),
  kind: z.enum(["work", "material"]),
  is_dummy: z.boolean(),
  flag: z.enum(["work_item", "missing_quantity_or_unit", "no_stock_record", "unit_mismatch", "unit_converted"]).nullable(),
  requested_original: z.object({ qty: z.number(), uom: z.string() }).optional(),
});

export const InventoryRowSchema = z.object({
  id,
  project_id: id,
  material: z.string(),
  uom: z.string(),
  physical: z.number(),
  reserved: z.number(),
  available: z.number(),
  is_dummy: z.boolean(),
});

export const DashboardStatsSchema = z.object({
  requisitions: z.object({
    total: z.number().int(),
    pending: z.number().int(),
    approved: z.number().int(),
    rejected: z.number().int(),
  }),
  rfqs_active: z.number().int(),
  pending_vendor_responses: z.number().int(),
  pending_quotations: z.number().int(),
  orders_placed: z.number().int(),
  spend_total: z.number(),
});

export const VendorPerformanceSchema = z.object({
  quality: z.number(),
  delivery: z.number(),
  disputes: z.number(),
  n: z.number().int(),
  is_dummy: z.boolean(),
});

export const RegistrationItemSchema = z.object({ label: z.string(), done: z.boolean() });

export const VendorSchema = z.object({
  id,
  name: z.string(),
  categories: z.array(z.string()),
  category_source: z.enum(["inferred", "manual"]),
  brands: z.array(z.string()),
  status: z.enum(["active", "blocked"]),
  registered: z.boolean(),
  registration_checklist: z.array(RegistrationItemSchema),
  performance: VendorPerformanceSchema.nullable(),
});

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
export const DecisionActionSchema = z.enum(["approve", "reject", "clarify"]);
export const DecisionInputSchema = z.object({
  action: DecisionActionSchema,
  note: z.string().trim().min(3, "Add a short note for the record").max(1000),
});

export const AssignCodeInputSchema = z.union([
  z.object({ item_code: z.string().trim().min(1) }),
  z.object({ new_code: z.string().trim().min(1) }),
]);

export const VendorInputSchema = z.object({
  name: z.string().trim().min(2, "Vendor name is required").max(200),
  categories: z.array(z.string().trim().min(1)).min(1, "Pick at least one category"),
  brands: z.array(z.string().trim().min(1)),
  status: z.enum(["active", "blocked"]),
});

export const PerformanceInputSchema = z.object({
  project_id: id,
  quality: z.number().int().min(1).max(5),
  delivery: z.number().int().min(1).max(5),
  disputes: z.number().int().min(1).max(5),
  note: z.string().trim().max(1000),
});

export type Role = z.infer<typeof RoleSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Uom = z.infer<typeof UomSchema>;
export type RequisitionStatus = z.infer<typeof RequisitionStatusSchema>;
export type ReqItem = z.infer<typeof ReqItemSchema>;
export type Requisition = z.infer<typeof RequisitionSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type MatchCodesResponse = z.infer<typeof MatchCodesResponseSchema>;
export type StockRow = z.infer<typeof StockRowSchema>;
export type InventoryRow = z.infer<typeof InventoryRowSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type Vendor = z.infer<typeof VendorSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type DecisionAction = z.infer<typeof DecisionActionSchema>;
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export type AssignCodeInput = z.infer<typeof AssignCodeInputSchema>;
export type VendorInput = z.infer<typeof VendorInputSchema>;
export type PerformanceInput = z.infer<typeof PerformanceInputSchema>;
