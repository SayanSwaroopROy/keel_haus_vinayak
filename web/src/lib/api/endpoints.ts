import { z } from "zod";
import { apiFetch, apiFetchBlob } from "./client";
import {
  DashboardStatsSchema,
  InventoryRowSchema,
  MatchCodesResponseSchema,
  NotificationSchema,
  ProjectSchema,
  ReqItemSchema,
  RequisitionSchema,
  RevisionSchema,
  StockRowSchema,
  UserSchema,
  VendorSchema,
  type AssignCodeInput,
  type DecisionInput,
  type PerformanceInput,
  type RequisitionStatus,
  type Role,
  type VendorInput,
} from "./schemas";
import {
  AlternativeSchema,
  ConversationSchema,
  EvaluationSchema,
  MessageSchema,
  QuotationSchema,
  RfqSchema,
  RfqVendorSchema,
  WorkOrderSchema,
  type AlternativeDecisionInput,
  type EvalWeights,
  type QuotationInput,
  type QuotationPatch,
  type RegistrationInput,
  type RevisionRequestInput,
  type RfqCreateInput,
  type SelectionInput,
  type WoApprovalInput,
  type WoCancelInput,
} from "./schemas-flow";

const NoContent = z.undefined();
const enc = encodeURIComponent;

export const api = {
  users: (role?: Role) =>
    apiFetch(`/users${role ? `?role=${enc(role)}` : ""}`, { schema: z.array(UserSchema), identified: false }),

  me: () => apiFetch("/me", { schema: UserSchema }),

  projects: () => (apiFetch("/projects", { schema: z.array(ProjectSchema) })),

  notifications: () =>
    apiFetch("/notifications", { schema: z.array(NotificationSchema) }),

  markNotificationRead: (id: string) =>
    apiFetch(`/notifications/${enc(id)}/read`, { method: "POST", schema: NoContent }),

  dashboardStats: () =>
    apiFetch("/dashboard/stats", { schema: DashboardStatsSchema }),

  requisitions: (status?: RequisitionStatus) =>
    apiFetch(`/requisitions${status ? `?status=${enc(status)}` : ""}`, { schema: z.array(RequisitionSchema) }),

  requisition: (id: string) =>
    apiFetch(`/requisitions/${enc(id)}`, { schema: RequisitionSchema }),

  revisions: (id: string) =>
    apiFetch(`/requisitions/${enc(id)}/revisions`, { schema: z.array(RevisionSchema) }),

  matchCodes: (id: string) =>
    apiFetch(`/requisitions/${enc(id)}/match-codes`, { method: "POST", schema: MatchCodesResponseSchema }),

  assignCode: (id: string, itemId: string, input: AssignCodeInput) =>
    apiFetch(`/requisitions/${enc(id)}/items/${enc(itemId)}/code`, { method: "POST", body: input, schema: ReqItemSchema }),

  stockCheck: (id: string) =>
    apiFetch(`/requisitions/${enc(id)}/stock-check`, { schema: z.array(StockRowSchema) }),

  decide: (id: string, input: DecisionInput) =>
    apiFetch(`/requisitions/${enc(id)}/decision`, { method: "POST", body: input, schema: RequisitionSchema }),

  inventory: (projectId?: string) =>
    apiFetch(`/inventory${projectId ? `?project_id=${enc(projectId)}` : ""}`, { schema: z.array(InventoryRowSchema) }),

  vendors: (category?: string) =>
    apiFetch(`/vendors${category ? `?category=${enc(category)}` : ""}`, { schema: z.array(VendorSchema) }),

  createVendor: (input: VendorInput) =>
    apiFetch("/vendors", { method: "POST", body: input, schema: VendorSchema }),

  updateVendor: (id: string, input: Partial<VendorInput>) =>
    apiFetch(`/vendors/${enc(id)}`, { method: "PATCH", body: input, schema: VendorSchema }),

  setRegistration: (id: string, input: RegistrationInput) =>
    apiFetch(`/vendors/${enc(id)}/registration`, { method: "PATCH", body: input, schema: VendorSchema }),

  addPerformance: (id: string, input: PerformanceInput) =>
    apiFetch(`/vendors/${enc(id)}/performance`, { method: "POST", body: input, schema: z.unknown() }).then(() => undefined),

  // RFQ
  rfqs: () => (apiFetch("/rfqs", { schema: z.array(RfqSchema) })),

  rfq: (id: string) => (apiFetch(`/rfqs/${enc(id)}`, { schema: RfqSchema })),

  createRfqs: (requisitionId: string, input: RfqCreateInput) =>
    apiFetch(`/requisitions/${enc(requisitionId)}/rfqs`, { method: "POST", body: input, schema: z.array(RfqSchema) }),

  sendRfq: (id: string) =>
    apiFetch(`/rfqs/${enc(id)}/send`, { method: "POST", schema: RfqSchema }),

  closeRfq: (id: string) =>
    apiFetch(`/rfqs/${enc(id)}/close`, { method: "POST", schema: RfqSchema }),

  cancelRequisition: (id: string) =>
    apiFetch(`/requisitions/${enc(id)}/cancel`, { method: "POST", schema: RequisitionSchema }),

  requestRevision: (rfqId: string, input: RevisionRequestInput) =>
    apiFetch(`/rfqs/${enc(rfqId)}/request-revision`, { method: "POST", body: input, schema: RfqVendorSchema }),

  // Chat
  conversations: () =>
    apiFetch("/conversations", { schema: z.array(ConversationSchema) }),

  messages: (conversationId: string) =>
    apiFetch(`/conversations/${enc(conversationId)}/messages`, { schema: z.array(MessageSchema) }),

  sendMessage: (conversationId: string, text: string, rfqItemId: string | null) =>
    apiFetch(`/conversations/${enc(conversationId)}/messages`, {
          method: "POST",
          body: { text, ...(rfqItemId ? { rfq_item_id: rfqItemId } : {}) },
          schema: MessageSchema,
        }),

  alternatives: (rfqId: string) => apiFetch(`/rfqs/${enc(rfqId)}/alternatives`, { schema: z.array(AlternativeSchema) }),

  decideAlternative: (id: string, input: AlternativeDecisionInput) =>
    apiFetch(`/alternatives/${enc(id)}/decision`, { method: "POST", body: input, schema: AlternativeSchema }),

  // Quotations and comparison
  quotations: (rfqId: string) =>
    apiFetch(`/rfqs/${enc(rfqId)}/quotations`, { schema: z.array(QuotationSchema) }),

  createQuotation: (rfqId: string, input: QuotationInput) =>
    apiFetch(`/rfqs/${enc(rfqId)}/quotations`, { method: "POST", body: input, schema: QuotationSchema }),

  patchQuotation: (id: string, input: QuotationPatch) =>
    apiFetch(`/quotations/${enc(id)}`, { method: "PATCH", body: input, schema: QuotationSchema }),

  evaluation: (rfqId: string) =>
    apiFetch(`/rfqs/${enc(rfqId)}/evaluation`, { schema: EvaluationSchema }),

  createEvaluation: (rfqId: string, weights?: EvalWeights) =>
    apiFetch(`/rfqs/${enc(rfqId)}/evaluation`, { method: "POST", body: weights ? { weights } : {}, schema: EvaluationSchema }),

  select: (evaluationId: string, input: SelectionInput) =>
    apiFetch(`/evaluations/${enc(evaluationId)}/select`, { method: "POST", body: input, schema: EvaluationSchema }),

  // Work orders
  createWorkOrders: (evaluationId: string) =>
    apiFetch(`/evaluations/${enc(evaluationId)}/work-order`, { method: "POST", schema: z.array(WorkOrderSchema) }),

  workOrders: () => (apiFetch("/work-orders", { schema: z.array(WorkOrderSchema) })),

  workOrder: (id: string) =>
    apiFetch(`/work-orders/${enc(id)}`, { schema: WorkOrderSchema }),

  submitWorkOrder: (id: string) =>
    apiFetch(`/work-orders/${enc(id)}/submit`, { method: "POST", schema: WorkOrderSchema }),

  decideWorkOrder: (id: string, input: WoApprovalInput) =>
    apiFetch(`/work-orders/${enc(id)}/approval`, { method: "POST", body: input, schema: WorkOrderSchema }),

  completeWorkOrder: (id: string) =>
    apiFetch(`/work-orders/${enc(id)}/complete`, { method: "POST", schema: WorkOrderSchema }),

  cancelWorkOrder: (id: string, input: WoCancelInput) =>
    apiFetch(`/work-orders/${enc(id)}/cancel`, { method: "POST", body: input, schema: WorkOrderSchema }),

  file: (id: string) => apiFetchBlob(`/files/${enc(id)}`),
};
