import { z } from "zod";
import { apiFetch, apiFetchBlob } from "./client";
import { isMocked } from "./mode";
import { flowApi } from "./mocks/flow";
import { mockApi } from "./mocks/handlers";
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
  EvalWeightsSchema,
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
} from "./schemas-flow";

const NoContent = z.undefined();
const enc = encodeURIComponent;

export const api = {
  users: (role?: Role) =>
    isMocked("users.list")
      ? mockApi.listUsers(role)
      : apiFetch(`/users${role ? `?role=${enc(role)}` : ""}`, { schema: z.array(UserSchema), identified: false }),

  me: () => apiFetch("/me", { schema: UserSchema }),

  projects: () => (isMocked("projects.list") ? mockApi.listProjects() : apiFetch("/projects", { schema: z.array(ProjectSchema) })),

  notifications: () =>
    isMocked("notifications") ? mockApi.listNotifications() : apiFetch("/notifications", { schema: z.array(NotificationSchema) }),

  markNotificationRead: (id: string) =>
    isMocked("notifications")
      ? mockApi.markNotificationRead(id)
      : apiFetch(`/notifications/${enc(id)}/read`, { method: "POST", schema: NoContent }),

  dashboardStats: () =>
    isMocked("dashboard.stats") ? mockApi.dashboardStats() : apiFetch("/dashboard/stats", { schema: DashboardStatsSchema }),

  requisitions: (status?: RequisitionStatus) =>
    isMocked("requisitions.list")
      ? mockApi.listRequisitions(status)
      : apiFetch(`/requisitions${status ? `?status=${enc(status)}` : ""}`, { schema: z.array(RequisitionSchema) }),

  requisition: (id: string) =>
    isMocked("requisitions.get")
      ? mockApi.getRequisition(id)
      : apiFetch(`/requisitions/${enc(id)}`, { schema: RequisitionSchema }),

  revisions: (id: string) =>
    isMocked("requisitions.revisions")
      ? mockApi.getRevisions(id)
      : apiFetch(`/requisitions/${enc(id)}/revisions`, { schema: z.array(RevisionSchema) }),

  matchCodes: (id: string) =>
    isMocked("requisitions.matchCodes")
      ? mockApi.matchCodes(id)
      : apiFetch(`/requisitions/${enc(id)}/match-codes`, { method: "POST", schema: MatchCodesResponseSchema }),

  assignCode: (id: string, itemId: string, input: AssignCodeInput) =>
    isMocked("requisitions.assignCode")
      ? mockApi.assignCode(id, itemId, input)
      : apiFetch(`/requisitions/${enc(id)}/items/${enc(itemId)}/code`, { method: "POST", body: input, schema: ReqItemSchema }),

  stockCheck: (id: string) =>
    isMocked("requisitions.stockCheck")
      ? mockApi.stockCheck(id)
      : apiFetch(`/requisitions/${enc(id)}/stock-check`, { schema: z.array(StockRowSchema) }),

  decide: (id: string, input: DecisionInput) =>
    isMocked("requisitions.decision")
      ? mockApi.decide(id, input)
      : apiFetch(`/requisitions/${enc(id)}/decision`, { method: "POST", body: input, schema: RequisitionSchema }),

  inventory: (projectId?: string) =>
    isMocked("inventory.list")
      ? mockApi.listInventory(projectId)
      : apiFetch(`/inventory${projectId ? `?project_id=${enc(projectId)}` : ""}`, { schema: z.array(InventoryRowSchema) }),

  vendors: (category?: string) =>
    isMocked("vendors.list")
      ? mockApi.listVendors(category)
      : apiFetch(`/vendors${category ? `?category=${enc(category)}` : ""}`, { schema: z.array(VendorSchema) }),

  createVendor: (input: VendorInput) =>
    isMocked("vendors.create")
      ? mockApi.createVendor(input)
      : apiFetch("/vendors", { method: "POST", body: input, schema: VendorSchema }),

  updateVendor: (id: string, input: Partial<VendorInput>) =>
    isMocked("vendors.update")
      ? mockApi.updateVendor(id, input)
      : apiFetch(`/vendors/${enc(id)}`, { method: "PATCH", body: input, schema: VendorSchema }),

  setRegistration: (id: string, input: RegistrationInput) =>
    isMocked("vendors.registration")
      ? mockApi.setRegistration(id, input)
      : apiFetch(`/vendors/${enc(id)}/registration`, { method: "PATCH", body: input, schema: VendorSchema }),

  addPerformance: (id: string, input: PerformanceInput) =>
    isMocked("vendors.performance")
      ? mockApi.addPerformance(id, input)
      : apiFetch(`/vendors/${enc(id)}/performance`, { method: "POST", body: input, schema: z.unknown() }).then(() => undefined),

  // RFQ
  rfqs: () => (isMocked("rfqs") ? flowApi.listRfqs() : apiFetch("/rfqs", { schema: z.array(RfqSchema) })),

  rfq: (id: string) => (isMocked("rfqs") ? flowApi.getRfq(id) : apiFetch(`/rfqs/${enc(id)}`, { schema: RfqSchema })),

  createRfqs: (requisitionId: string, input: RfqCreateInput) =>
    isMocked("rfqs")
      ? flowApi.createRfqs(requisitionId, input)
      : apiFetch(`/requisitions/${enc(requisitionId)}/rfqs`, { method: "POST", body: input, schema: z.array(RfqSchema) }),

  sendRfq: (id: string) =>
    isMocked("rfqs") ? flowApi.sendRfq(id) : apiFetch(`/rfqs/${enc(id)}/send`, { method: "POST", schema: RfqSchema }),

  requestRevision: (rfqId: string, input: RevisionRequestInput) =>
    isMocked("quotations")
      ? flowApi.requestRevision(rfqId, input)
      : apiFetch(`/rfqs/${enc(rfqId)}/request-revision`, { method: "POST", body: input, schema: RfqVendorSchema }),

  // Chat
  conversations: () =>
    isMocked("conversations") ? flowApi.listConversations() : apiFetch("/conversations", { schema: z.array(ConversationSchema) }),

  messages: (conversationId: string) =>
    isMocked("conversations")
      ? flowApi.listMessages(conversationId)
      : apiFetch(`/conversations/${enc(conversationId)}/messages`, { schema: z.array(MessageSchema) }),

  sendMessage: (conversationId: string, text: string, rfqItemId: string | null) =>
    isMocked("conversations")
      ? flowApi.sendMessage(conversationId, text, rfqItemId)
      : apiFetch(`/conversations/${enc(conversationId)}/messages`, {
          method: "POST",
          body: { text, ...(rfqItemId ? { rfq_item_id: rfqItemId } : {}) },
          schema: MessageSchema,
        }),

  // The contract has no read endpoint for alternatives yet; the mock stands in until SETUP adds one.
  alternatives: (rfqId: string) => flowApi.listAlternatives(rfqId),

  decideAlternative: (id: string, input: AlternativeDecisionInput) =>
    isMocked("alternatives")
      ? flowApi.decideAlternative(id, input)
      : apiFetch(`/alternatives/${enc(id)}/decision`, { method: "POST", body: input, schema: AlternativeSchema }),

  // Quotations and comparison
  quotations: (rfqId: string) =>
    isMocked("quotations") ? flowApi.listQuotations(rfqId) : apiFetch(`/rfqs/${enc(rfqId)}/quotations`, { schema: z.array(QuotationSchema) }),

  createQuotation: (rfqId: string, input: QuotationInput) =>
    isMocked("quotations")
      ? flowApi.createQuotation(rfqId, input)
      : apiFetch(`/rfqs/${enc(rfqId)}/quotations`, { method: "POST", body: input, schema: QuotationSchema }),

  patchQuotation: (id: string, input: QuotationPatch) =>
    isMocked("quotations")
      ? flowApi.patchQuotation(id, input)
      : apiFetch(`/quotations/${enc(id)}`, { method: "PATCH", body: input, schema: QuotationSchema }),

  evaluation: (rfqId: string) =>
    isMocked("evaluation") ? flowApi.getEvaluation(rfqId) : apiFetch(`/rfqs/${enc(rfqId)}/evaluation`, { schema: EvaluationSchema }),

  createEvaluation: (rfqId: string, weights?: EvalWeights) =>
    isMocked("evaluation")
      ? flowApi.createEvaluation(rfqId, weights ? EvalWeightsSchema.parse(weights) : undefined)
      : apiFetch(`/rfqs/${enc(rfqId)}/evaluation`, { method: "POST", body: weights ? { weights } : {}, schema: EvaluationSchema }),

  select: (evaluationId: string, input: SelectionInput) =>
    isMocked("evaluation")
      ? flowApi.select(evaluationId, input)
      : apiFetch(`/evaluations/${enc(evaluationId)}/select`, { method: "POST", body: input, schema: EvaluationSchema }),

  // Work orders
  createWorkOrders: (evaluationId: string) =>
    isMocked("workOrders")
      ? flowApi.createWorkOrders(evaluationId)
      : apiFetch(`/evaluations/${enc(evaluationId)}/work-order`, { method: "POST", schema: z.array(WorkOrderSchema) }),

  workOrders: () => (isMocked("workOrders") ? flowApi.listWorkOrders() : apiFetch("/work-orders", { schema: z.array(WorkOrderSchema) })),

  workOrder: (id: string) =>
    isMocked("workOrders") ? flowApi.getWorkOrder(id) : apiFetch(`/work-orders/${enc(id)}`, { schema: WorkOrderSchema }),

  submitWorkOrder: (id: string) =>
    isMocked("workOrders") ? flowApi.submitWorkOrder(id) : apiFetch(`/work-orders/${enc(id)}/submit`, { method: "POST", schema: WorkOrderSchema }),

  decideWorkOrder: (id: string, input: WoApprovalInput) =>
    isMocked("workOrders")
      ? flowApi.decideWorkOrder(id, input)
      : apiFetch(`/work-orders/${enc(id)}/approval`, { method: "POST", body: input, schema: WorkOrderSchema }),

  file: (id: string): Promise<Blob | null> => (isMocked("files.get") ? Promise.resolve(null) : apiFetchBlob(`/files/${enc(id)}`)),
};
