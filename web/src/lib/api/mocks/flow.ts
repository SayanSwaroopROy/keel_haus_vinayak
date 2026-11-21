import { useSession } from "../../auth/session";
import { ApiError } from "../errors";
import type { Requisition, RequisitionStatus, Role, Vendor } from "../schemas";
import type {
  Alternative,
  AlternativeDecisionInput,
  Conversation,
  EvalWeights,
  Evaluation,
  Message,
  Quotation,
  QuotationInput,
  QuotationPatch,
  Rfq,
  RfqCreateInput,
  RevisionRequestInput,
  SelectionInput,
  WoApprovalInput,
  WoCancelInput,
  WorkOrder,
} from "../schemas-flow";
import { MOCK_PROJECTS } from "./fixtures";
import { stockRowsFor } from "./handlers";
import { DEMO_TERMS } from "./seed-flow";
import { DEFAULT_WEIGHTS, buildQuotation, computeEvaluation } from "./quote-logic";
import { delay, findRfq, findVendor, getStore, nextId, notify, type EvaluationState } from "./store";

const currentUser = () => useSession.getState().user;

function requireRole(...roles: Role[]): void {
  const role = currentUser()?.role;
  if (!role || !roles.includes(role)) throw new ApiError(403, "forbidden", "This action belongs to a different role.");
}

function setRequisitionStatus(id: string, status: RequisitionStatus): void {
  const requisition = getStore().requisitions.find((row) => row.id === id);
  if (requisition) requisition.status = status;
}

const CANCEL_BLOCKED: ReadonlySet<RequisitionStatus> = new Set(["WO_GENERATED", "ORDER_PLACED", "COMPLETED", "CANCELLED"]);

function closeRfqRows(rfq: Rfq): void {
  rfq.status = "CLOSED";
  for (const row of rfq.vendors) {
    if (row.status === "AWARDED" || row.status === "NOT_AWARDED") continue;
    row.status = row.status === "DRAFT" ? "CANCELLED" : "CLOSED";
  }
  for (const conversation of getStore().conversations.filter((entry) => entry.rfq_id === rfq.id)) conversation.status = "closed";
}

function conversationFor(rfq: Rfq, vendorId: string): Conversation {
  const store = getStore();
  const existing = store.conversations.find((row) => row.rfq_id === rfq.id && row.vendor_id === vendorId);
  if (existing) return existing;
  const conversation: Conversation = {
    id: nextId(64),
    rfq_id: rfq.id,
    requisition_id: rfq.requisition_id,
    vendor_id: vendorId,
    vendor_name: findVendor(vendorId).name,
    last_message: null,
    unread: 0,
    status: "open",
    last_activity: new Date().toISOString(),
  };
  store.conversations.push(conversation);
  return conversation;
}

function pushMessage(
  conversation: Conversation,
  sender: "hod" | "system",
  text: string,
  rfqItemId: string | null = null,
): Message {
  const message: Message = {
    id: nextId(65),
    conversation_id: conversation.id,
    rfq_id: conversation.rfq_id,
    requisition_id: conversation.requisition_id,
    vendor_id: conversation.vendor_id,
    sender_id: sender === "hod" ? (currentUser()?.id ?? null) : null,
    sender_role: sender,
    type: sender === "system" ? "system" : "text",
    text,
    transcript: null,
    audio_url: null,
    rfq_item_id: rfqItemId,
    created_at: new Date().toISOString(),
    read_at: new Date().toISOString(),
  };
  getStore().messages.push(message);
  conversation.last_message = text;
  conversation.last_activity = message.created_at;
  return message;
}

function evaluationState(rfqId: string): EvaluationState | undefined {
  return getStore().evaluations.find((row) => row.rfq_id === rfqId);
}

function buildEvaluation(state: EvaluationState): Evaluation {
  const store = getStore();
  return computeEvaluation({
    id: state.id,
    rfq: findRfq(state.rfq_id),
    quotations: store.quotations.filter((row) => row.rfq_id === state.rfq_id),
    vendors: store.vendors,
    weights: state.weights,
    selections: state.selections,
    note: state.note,
  });
}

const findWorkOrder = (id: string): WorkOrder => {
  const order = getStore().workOrders.find((row) => row.id === id);
  if (!order) throw new ApiError(404, "not_found", "Work order not found");
  return order;
};

export const flowApi = {
  // RFQ
  async listRfqs(): Promise<Rfq[]> {
    return delay(getStore().rfqs);
  },

  async getRfq(id: string): Promise<Rfq> {
    return delay(findRfq(id));
  },

  async createRfqs(requisitionId: string, input: RfqCreateInput): Promise<Rfq[]> {
    const store = getStore();
    const requisition = store.requisitions.find((row) => row.id === requisitionId);
    if (!requisition) throw new ApiError(404, "not_found", "Requisition not found");
    if (requisition.status !== "APPROVED") {
      throw new ApiError(409, "invalid_transition", "RFQs can only be raised for an approved requisition.");
    }
    if (store.rfqs.some((row) => row.requisition_id === requisitionId)) {
      throw new ApiError(409, "conflict", "RFQs already exist for this requisition.");
    }

    const stock = stockRowsFor(requisition);
    const lines = requisition.items.flatMap((item) => {
      if (item.quantity === null || item.uom === null) return [];
      const quantity = item.kind === "material" ? (stock.find((row) => row.req_item_id === item.id)?.to_procure ?? 0) : item.quantity;
      return quantity > 0 ? [{ item, quantity }] : [];
    });
    if (lines.length === 0) throw new ApiError(422, "validation_error", "Nothing to procure: site stock covers every line.");

    const categories = [...new Set(lines.map((line) => line.item.category ?? "General"))];
    const created: Rfq[] = [];
    for (const category of categories) {
      const eligible = store.vendors.filter(
        (vendor) =>
          vendor.status === "active" &&
          vendor.categories.includes(category) &&
          (input.vendor_ids === undefined || input.vendor_ids.includes(vendor.id)),
      );
      if (eligible.length < 3) {
        throw new ApiError(422, "validation_error", `${category}: only ${eligible.length} eligible vendor${eligible.length === 1 ? "" : "s"}. Pick at least 3.`);
      }
      created.push({
        id: nextId(60),
        requisition_id: requisitionId,
        category,
        items: lines
          .filter((line) => (line.item.category ?? "General") === category)
          .map((line) => ({
            id: nextId(62),
            req_item_id: line.item.id,
            description: line.item.description,
            spec: line.item.spec,
            brand: line.item.brand,
            uom: line.item.uom ?? "NOS",
            quantity: line.quantity,
            spec_version: 1,
          })),
        terms: DEMO_TERMS,
        due_date: input.due_date,
        status: "DRAFT",
        vendors: eligible.map((vendor) => ({ vendor_id: vendor.id, vendor_name: vendor.name, status: "RFQ_SENT" as const, viewed_at: null })),
      });
    }
    store.rfqs.push(...created);
    return delay(created);
  },

  async sendRfq(id: string): Promise<Rfq> {
    requireRole("hod");
    const rfq = findRfq(id);
    if (rfq.status !== "DRAFT") throw new ApiError(409, "invalid_transition", "This RFQ was already sent.");
    rfq.status = "SENT";
    for (const row of rfq.vendors) pushMessage(conversationFor(rfq, row.vendor_id), "system", `RFQ sent. Due ${rfq.due_date}.`);
    setRequisitionStatus(rfq.requisition_id, "RFQ_FLOATED");
    return delay(rfq);
  },

  async closeRfq(id: string): Promise<Rfq> {
    requireRole("hod");
    const rfq = findRfq(id);
    if (rfq.status !== "SENT") throw new ApiError(409, "invalid_transition", "Only an RFQ that is out for quotation can be closed.");
    closeRfqRows(rfq);
    return delay(rfq);
  },

  async cancelRequisition(id: string): Promise<Requisition> {
    requireRole("hod", "site_engineer");
    const requisition = getStore().requisitions.find((row) => row.id === id);
    if (!requisition) throw new ApiError(404, "not_found", "Requisition not found.");
    if (CANCEL_BLOCKED.has(requisition.status)) {
      throw new ApiError(409, "invalid_transition", "A requisition cannot be cancelled once the work order exists or it is already closed.");
    }
    for (const rfq of getStore().rfqs.filter((row) => row.requisition_id === id && (row.status === "DRAFT" || row.status === "SENT"))) {
      closeRfqRows(rfq);
    }
    requisition.status = "CANCELLED";
    return delay(requisition);
  },

  async requestRevision(rfqId: string, input: RevisionRequestInput): Promise<Rfq["vendors"][number]> {
    const rfq = findRfq(rfqId);
    if (evaluationState(rfqId)?.selections) throw new ApiError(409, "conflict", "A vendor is already selected for this RFQ.");
    const row = rfq.vendors.find((entry) => entry.vendor_id === input.vendor_id);
    if (!row) throw new ApiError(404, "not_found", "Vendor is not on this RFQ.");
    row.status = "REVISION_REQUESTED";
    const conversation = conversationFor(rfq, row.vendor_id);
    pushMessage(conversation, "hod", input.note);
    pushMessage(conversation, "system", "Revision requested. The vendor can resubmit through the quotation form.");
    return delay(row);
  },

  // Chat
  async listConversations(): Promise<Conversation[]> {
    const store = getStore();
    const rows = store.conversations.map((conversation) => ({
      ...conversation,
      unread: store.messages.filter((row) => row.conversation_id === conversation.id && row.sender_role === "vendor" && row.read_at === null).length,
    }));
    return delay(rows.sort((a, b) => b.last_activity.localeCompare(a.last_activity)), 160);
  },

  async listMessages(conversationId: string): Promise<Message[]> {
    const store = getStore();
    const rows = store.messages.filter((row) => row.conversation_id === conversationId);
    const stamp = new Date().toISOString();
    for (const row of rows) if (row.sender_role === "vendor" && row.read_at === null) row.read_at = stamp;
    return delay(rows.sort((a, b) => a.created_at.localeCompare(b.created_at)), 120);
  },

  async sendMessage(conversationId: string, text: string, rfqItemId: string | null): Promise<Message> {
    const conversation = getStore().conversations.find((row) => row.id === conversationId);
    if (!conversation) throw new ApiError(404, "not_found", "Conversation not found");
    return delay(pushMessage(conversation, "hod", text, rfqItemId), 120);
  },

  // Alternatives. GET /rfqs/{id}/alternatives is NOT in docs/API_CONTRACT.md: the contract lists only the
  // vendor POST and the HOD decision. SETUP must add a read endpoint before this can leave the mock.
  async listAlternatives(rfqId: string): Promise<Alternative[]> {
    const rfq = findRfq(rfqId);
    const itemIds = new Set(rfq.items.map((row) => row.id));
    return delay(getStore().alternatives.filter((row) => itemIds.has(row.rfq_item_id)));
  },

  async decideAlternative(id: string, input: AlternativeDecisionInput): Promise<Alternative> {
    const store = getStore();
    const alternative = store.alternatives.find((row) => row.id === id);
    if (!alternative) throw new ApiError(404, "not_found", "Alternative not found");
    if (alternative.status !== "PROPOSED" && alternative.status !== "INFO_REQUESTED") {
      throw new ApiError(409, "invalid_transition", "This alternative was already decided.");
    }
    const rfq = store.rfqs.find((row) => row.items.some((item) => item.id === alternative.rfq_item_id));
    const item = rfq?.items.find((row) => row.id === alternative.rfq_item_id);
    const vendorRow = rfq?.vendors.find((row) => row.vendor_id === alternative.vendor_id);
    const next = { accept: "ACCEPTED", reject: "REJECTED", request_info: "INFO_REQUESTED" } as const;
    alternative.status = next[input.action];
    if (input.action !== "request_info") alternative.decided_at = new Date().toISOString();
    if (input.action === "accept" && item) {
      item.spec = alternative.proposed_spec;
      item.brand = alternative.proposed_brand;
      item.spec_version += 1;
    }
    if (rfq && vendorRow) {
      if (vendorRow.status === "ALTERNATIVE_PROPOSED") {
        vendorRow.status = input.action === "accept" ? "ALTERNATIVE_APPROVED" : input.action === "reject" ? "ALTERNATIVE_REJECTED" : "ALTERNATIVE_PROPOSED";
      }
      const verb = { accept: "accepted", reject: "rejected", request_info: "needs more information on" }[input.action];
      pushMessage(conversationFor(rfq, alternative.vendor_id), "system", `The HOD ${verb} your alternative: ${input.note}`, alternative.rfq_item_id);
    }
    return delay(alternative);
  },

  // Quotations
  async listQuotations(rfqId: string): Promise<Quotation[]> {
    findRfq(rfqId);
    return delay(getStore().quotations.filter((row) => row.rfq_id === rfqId).sort((a, b) => a.round - b.round));
  },

  async createQuotation(rfqId: string, input: QuotationInput): Promise<Quotation> {
    const store = getStore();
    const rfq = findRfq(rfqId);
    if (rfq.status === "DRAFT") throw new ApiError(409, "invalid_transition", "Send the RFQ before taking quotations.");
    if (evaluationState(rfqId)?.selections) throw new ApiError(409, "conflict", "A vendor is already selected. Quotations are closed.");
    if (!input.vendor_id) throw new ApiError(422, "validation_error", "Pick the vendor this quotation is for.");
    const row = rfq.vendors.find((entry) => entry.vendor_id === input.vendor_id);
    if (!row) throw new ApiError(404, "not_found", "Vendor is not on this RFQ.");
    const { vendor_id: vendorId, ...form } = input;
    const round = Math.max(0, ...store.quotations.filter((q) => q.rfq_id === rfqId && q.vendor_id === vendorId).map((q) => q.round)) + 1;
    const draft = buildQuotation(rfq, vendorId, round, form, nextId(61), "SUBMITTED");
    const quotation = { ...draft, status: draft.flags.length > 0 ? "NEEDS_REVIEW" : "SUBMITTED" };
    store.quotations.push(quotation);
    row.status = "QUOTATION_SUBMITTED";
    const requisition = store.requisitions.find((entry) => entry.id === rfq.requisition_id);
    if (requisition?.status === "RFQ_FLOATED") requisition.status = "UNDER_EVALUATION";
    return delay(quotation);
  },

  async patchQuotation(id: string, patch: QuotationPatch): Promise<Quotation> {
    const store = getStore();
    const index = store.quotations.findIndex((row) => row.id === id);
    if (index < 0) throw new ApiError(404, "not_found", "Quotation not found");
    const current = store.quotations[index];
    const { status, ...fields } = patch;
    void status;
    const rebuilt = buildQuotation(
      findRfq(current.rfq_id),
      current.vendor_id,
      current.round,
      {
        quote_date: current.quote_date,
        validity_days: current.validity_days,
        gst_pct: current.gst_pct,
        gst_included: current.gst_included,
        freight: current.freight,
        payment_terms: current.payment_terms,
        advance_pct: current.advance_pct,
        start_days: current.start_days,
        warranty: current.warranty,
        escalation_clause: current.escalation_clause,
        brands: current.brands,
        remarks: current.remarks,
        items: current.items.map((line) => ({
          rfq_item_id: line.rfq_item_id ?? "",
          uom_quoted: line.uom_quoted ?? "",
          qty_quoted: line.qty_quoted,
          rate: line.rate,
        })),
        ...fields,
      },
      current.id,
      "VERIFIED",
    );
    store.quotations[index] = rebuilt;
    return delay(rebuilt);
  },

  // Evaluation
  async getEvaluation(rfqId: string): Promise<Evaluation> {
    const state = evaluationState(rfqId);
    if (!state) throw new ApiError(404, "not_found", "No comparison yet for this RFQ.");
    return delay(buildEvaluation(state));
  },

  async createEvaluation(rfqId: string, weights?: EvalWeights): Promise<Evaluation> {
    const store = getStore();
    findRfq(rfqId);
    if (!store.quotations.some((row) => row.rfq_id === rfqId)) {
      throw new ApiError(422, "validation_error", "No quotations to compare yet.");
    }
    const existing = evaluationState(rfqId);
    const state: EvaluationState = existing ?? { id: nextId(68), rfq_id: rfqId, weights: { ...DEFAULT_WEIGHTS }, selections: null, note: null };
    if (weights) state.weights = weights;
    if (!existing) store.evaluations.push(state);
    return delay(buildEvaluation(state), 200);
  },

  async select(evaluationId: string, input: SelectionInput): Promise<Evaluation> {
    requireRole("hod");
    const store = getStore();
    const state = store.evaluations.find((row) => row.id === evaluationId);
    if (!state) throw new ApiError(404, "not_found", "Evaluation not found");
    const rfq = findRfq(state.rfq_id);
    if (store.workOrders.some((row) => row.rfq_id === rfq.id && row.status !== "CANCELLED")) {
      throw new ApiError(409, "conflict", "Work orders already exist for this RFQ.");
    }
    const covered = new Set(input.selections.map((row) => row.rfq_item_id));
    if (rfq.items.some((item) => !covered.has(item.id)) || covered.size !== input.selections.length) {
      throw new ApiError(422, "validation_error", "Pick exactly one vendor for every line item.");
    }
    for (const pick of input.selections) {
      if (!store.quotations.some((row) => row.rfq_id === rfq.id && row.vendor_id === pick.vendor_id)) {
        throw new ApiError(422, "validation_error", "A selected vendor has not quoted.");
      }
    }
    state.selections = input.selections;
    state.note = input.note;
    const chosen = new Set(input.selections.map((row) => row.vendor_id));
    for (const row of rfq.vendors) row.status = chosen.has(row.vendor_id) ? "AWARDED" : "NOT_AWARDED";
    rfq.status = "AWARDED";
    setRequisitionStatus(rfq.requisition_id, "VENDOR_SELECTED");
    return delay(buildEvaluation(state));
  },

  // Work orders
  async createWorkOrders(evaluationId: string): Promise<WorkOrder[]> {
    requireRole("hod");
    const store = getStore();
    const state = store.evaluations.find((row) => row.id === evaluationId);
    if (!state) throw new ApiError(404, "not_found", "Evaluation not found");
    if (!state.selections) throw new ApiError(409, "invalid_transition", "Select a vendor for every line item first.");
    const rfq = findRfq(state.rfq_id);
    if (store.workOrders.some((row) => row.rfq_id === rfq.id && row.status !== "CANCELLED")) {
      throw new ApiError(409, "conflict", "Work orders already exist for this RFQ.");
    }
    const vendorIds = [...new Set(state.selections.map((row) => row.vendor_id))];
    const unregistered = vendorIds.map(findVendor).filter((vendor: Vendor) => !vendor.registered);
    if (unregistered.length > 0) {
      throw new ApiError(409, "vendor_not_registered", `${unregistered.map((vendor) => vendor.name).join(", ")}: registration checklist is incomplete.`);
    }

    const evaluation = buildEvaluation(state);
    const requisition = store.requisitions.find((row) => row.id === rfq.requisition_id);
    const projectCode = MOCK_PROJECTS.find((row) => row.id === requisition?.project_id)?.code ?? "PRJ";
    const created: WorkOrder[] = vendorIds.map((vendorId) => {
      const row = evaluation.rows.find((entry) => entry.vendor_id === vendorId);
      const quotation = store.quotations.filter((q) => q.rfq_id === rfq.id && q.vendor_id === vendorId).sort((a, b) => b.round - a.round)[0];
      const items = (state.selections ?? [])
        .filter((pick) => pick.vendor_id === vendorId)
        .map((pick) => {
          const rfqItem = rfq.items.find((entry) => entry.id === pick.rfq_item_id);
          const line = row?.line_items.find((entry) => entry.rfq_item_id === pick.rfq_item_id);
          const rate = line?.rate_in_rfq_uom ?? 0;
          const qty = rfqItem?.quantity ?? 0;
          return { description: rfqItem?.description ?? "Line", uom: rfqItem?.uom ?? "NOS", qty, rate, amount: Math.round(rate * qty * 100) / 100 };
        });
      const subtotal = Math.round(items.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
      const gst = quotation.gst_included || quotation.gst_pct === null ? 0 : Math.round(((subtotal * quotation.gst_pct) / 100) * 100) / 100;
      const freight = quotation.freight ?? 0;
      const sequence = store.workOrders.length + 1;
      const order: WorkOrder = {
        id: nextId(66),
        wo_number: `VG/${projectCode}/WO/26-27/${String(sequence).padStart(3, "0")}`,
        requisition_id: rfq.requisition_id,
        rfq_id: rfq.id,
        vendor: { id: vendorId, name: findVendor(vendorId).name },
        items,
        subtotal,
        gst,
        freight,
        total: Math.round((subtotal + gst + freight) * 100) / 100,
        terms: rfq.terms,
        approved_by: null,
        status: "GENERATED",
        created_at: new Date().toISOString(),
      };
      store.workOrders.push(order);
      return order;
    });
    setRequisitionStatus(rfq.requisition_id, "WO_GENERATED");
    return delay(created);
  },

  async listWorkOrders(): Promise<WorkOrder[]> {
    return delay([...getStore().workOrders].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },

  async getWorkOrder(id: string): Promise<WorkOrder> {
    return delay(findWorkOrder(id));
  },

  async submitWorkOrder(id: string): Promise<WorkOrder> {
    requireRole("hod");
    const order = findWorkOrder(id);
    if (order.status !== "GENERATED") throw new ApiError(409, "invalid_transition", "Only a generated work order can go for approval.");
    order.status = "PENDING_APPROVAL";
    notify("management", "wo_approval_requested", "work_order", order.id, `Work Order ${order.wo_number} needs your approval`);
    return delay(order);
  },

  async decideWorkOrder(id: string, input: WoApprovalInput): Promise<WorkOrder> {
    requireRole("management");
    const order = findWorkOrder(id);
    if (order.status !== "PENDING_APPROVAL") throw new ApiError(409, "invalid_transition", "This work order is not awaiting approval.");
    if (input.action === "approve") {
      order.status = "SENT";
      order.approved_by = currentUser()?.name ?? "Management";
      setRequisitionStatus(order.requisition_id, "ORDER_PLACED");
      notify("hod", "wo_decided", "work_order", order.id, `Work Order ${order.wo_number} approved: ${input.note}`);
    } else {
      order.status = "GENERATED";
      notify("hod", "wo_decided", "work_order", order.id, `Work Order ${order.wo_number} sent back: ${input.note}`);
    }
    return delay(order);
  },

  async completeWorkOrder(id: string): Promise<WorkOrder> {
    requireRole("hod");
    const order = findWorkOrder(id);
    if (order.status !== "ACKNOWLEDGED") throw new ApiError(409, "invalid_transition", "Only an acknowledged work order can be completed.");
    order.status = "COMPLETED";
    const siblings = getStore().workOrders.filter((row) => row.requisition_id === order.requisition_id && row.status !== "CANCELLED");
    if (siblings.every((row) => row.status === "COMPLETED")) setRequisitionStatus(order.requisition_id, "COMPLETED");
    return delay(order);
  },

  async cancelWorkOrder(id: string, input: WoCancelInput): Promise<WorkOrder> {
    requireRole("hod", "management");
    const role = currentUser()?.role;
    const order = findWorkOrder(id);
    if (!input.reason.trim()) throw new ApiError(422, "validation_error", "Give a reason for cancelling.");
    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new ApiError(409, "invalid_transition", "A completed or cancelled work order cannot be cancelled.");
    }
    const issued = order.status === "SENT" || order.status === "ACKNOWLEDGED";
    if (role === "hod" && issued) throw new ApiError(403, "forbidden", "Only management can cancel a work order once it is sent.");
    if (role === "management" && !issued) throw new ApiError(403, "forbidden", "Management cancels only after the work order is sent.");
    order.status = "CANCELLED";
    const live = getStore().workOrders.filter((row) => row.requisition_id === order.requisition_id && row.status !== "CANCELLED");
    if (live.length === 0) setRequisitionStatus(order.requisition_id, "VENDOR_SELECTED");
    notify(role === "management" ? "hod" : "management", "wo_decided", "work_order", order.id, `Work Order ${order.wo_number} cancelled: ${input.reason}`);
    return delay(order);
  },
};

