import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { useSession } from "../../auth/session";
import {
  AlternativeSchema,
  ConversationSchema,
  EvaluationSchema,
  MessageSchema,
  QuotationSchema,
  RfqSchema,
  WorkOrderSchema,
} from "../schemas-flow";
import { flowApi } from "./flow";
import { MOCK_USERS, mockId } from "./fixtures";
import { getStore, resetMockStore } from "./store";

const hod = MOCK_USERS.find((row) => row.role === "hod");
const management = MOCK_USERS.find((row) => row.role === "management");
if (!hod || !management) throw new Error("fixture users missing");

const ROAD_RFQ = mockId(60, 1);
const PAVER = mockId(62, 1);
const KERB = mockId(62, 2);

describe("seeded procurement flow matches the contract", () => {
  beforeEach(() => resetMockStore());

  it("every seeded record parses", async () => {
    useSession.setState({ user: hod });
    expect(z.array(RfqSchema).safeParse(await flowApi.listRfqs()).success).toBe(true);
    expect(z.array(QuotationSchema).safeParse(await flowApi.listQuotations(ROAD_RFQ)).success).toBe(true);
    expect(EvaluationSchema.safeParse(await flowApi.getEvaluation(ROAD_RFQ)).success).toBe(true);
    expect(z.array(AlternativeSchema).safeParse(await flowApi.listAlternatives(ROAD_RFQ)).success).toBe(true);
    expect(z.array(ConversationSchema).safeParse(await flowApi.listConversations()).success).toBe(true);
    expect(z.array(WorkOrderSchema).safeParse(await flowApi.listWorkOrders()).success).toBe(true);
    const [first] = await flowApi.listConversations();
    expect(z.array(MessageSchema).safeParse(await flowApi.listMessages(first.id)).success).toBe(true);
  });

  it("converts a quote given per SQFT into the RFQ's SQM and flags it", async () => {
    const quotes = await flowApi.listQuotations(ROAD_RFQ);
    const metro = quotes.find((row) => row.vendor_id === mockId(50, 5));
    const paver = metro?.items.find((row) => row.rfq_item_id === PAVER);
    expect(paver?.rate_in_rfq_uom).toBeCloseTo(72 * 10.7639, 1);
    expect(metro?.flags).toEqual(expect.arrayContaining(["unit_mismatch", "expired_offer", "payment_terms_open", "escalation_clause"]));
  });

  it("evaluates the latest round and keeps earlier rounds visible", async () => {
    const evaluation = await flowApi.getEvaluation(ROAD_RFQ);
    const paving = evaluation.rows.find((row) => row.vendor_id === mockId(50, 3));
    expect(paving?.round).toBe(2);
    expect(paving?.rounds.map((row) => row.round)).toEqual([1, 2]);
    expect(evaluation.item_selections).toBeNull();
  });
});

describe("selection, registration and work order gates", () => {
  beforeEach(() => {
    resetMockStore();
    useSession.setState({ user: hod });
  });

  it("refuses a selection that leaves a line without a vendor", async () => {
    const evaluation = await flowApi.getEvaluation(ROAD_RFQ);
    await expect(
      flowApi.select(evaluation.id, { selections: [{ rfq_item_id: PAVER, vendor_id: mockId(50, 3) }], note: "only one line" }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  it("blocks a Work Order for an unregistered vendor, then allows it once the checklist is ticked", async () => {
    const evaluation = await flowApi.getEvaluation(ROAD_RFQ);
    const metro = mockId(50, 5);
    await flowApi.select(evaluation.id, {
      selections: [
        { rfq_item_id: PAVER, vendor_id: mockId(50, 3) },
        { rfq_item_id: KERB, vendor_id: metro },
      ],
      note: "pavers from Paving Co, kerb from Metro",
    });
    await expect(flowApi.createWorkOrders(evaluation.id)).rejects.toMatchObject({ code: "vendor_not_registered", status: 409 });

    const vendor = getStore().vendors.find((row) => row.id === metro);
    expect(vendor?.registered).toBe(false);
  });

  it("raises one Work Order per selected vendor, holding only that vendor's lines", async () => {
    const evaluation = await flowApi.getEvaluation(ROAD_RFQ);
    await flowApi.select(evaluation.id, {
      selections: [
        { rfq_item_id: PAVER, vendor_id: mockId(50, 3) },
        { rfq_item_id: KERB, vendor_id: mockId(50, 4) },
      ],
      note: "split award",
    });
    const orders = await flowApi.createWorkOrders(evaluation.id);
    expect(orders).toHaveLength(2);
    const paving = orders.find((row) => row.vendor.id === mockId(50, 3));
    expect(paving?.items.map((row) => row.description)).toEqual(["Paver Block 60mm"]);
    expect(orders.every((row) => row.status === "GENERATED")).toBe(true);
    await expect(flowApi.createWorkOrders(evaluation.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("closes quotations once a vendor is selected", async () => {
    const evaluation = await flowApi.getEvaluation(ROAD_RFQ);
    await flowApi.select(evaluation.id, {
      selections: [
        { rfq_item_id: PAVER, vendor_id: mockId(50, 3) },
        { rfq_item_id: KERB, vendor_id: mockId(50, 3) },
      ],
      note: "one vendor",
    });
    await expect(
      flowApi.createQuotation(ROAD_RFQ, {
        vendor_id: mockId(50, 4),
        quote_date: "2026-11-20",
        validity_days: 30,
        gst_pct: 18,
        gst_included: false,
        freight: 0,
        payment_terms: "30 days",
        advance_pct: 0,
        start_days: 5,
        warranty: "12 months",
        escalation_clause: false,
        brands: [],
        remarks: null,
        items: [{ rfq_item_id: PAVER, uom_quoted: "SQM", qty_quoted: 650, rate: 700 }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("work order approval is management's alone", () => {
  beforeEach(() => resetMockStore());
  const pendingId = mockId(66, 1);

  it("an HOD cannot approve", async () => {
    useSession.setState({ user: hod });
    await expect(flowApi.decideWorkOrder(pendingId, { action: "approve", note: "trying anyway" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("management approval sends the Work Order and records who approved", async () => {
    useSession.setState({ user: management });
    const order = await flowApi.decideWorkOrder(pendingId, { action: "approve", note: "within budget" });
    expect(order.status).toBe("SENT");
    expect(order.approved_by).toBe(management.name);
  });

  it("a send-back returns the Work Order to the HOD as a draft", async () => {
    useSession.setState({ user: management });
    const order = await flowApi.decideWorkOrder(pendingId, { action: "reject", note: "renegotiate freight" });
    expect(order.status).toBe("GENERATED");
    expect(order.approved_by).toBeNull();
  });

  it("only a draft can be submitted, and only by the HOD", async () => {
    useSession.setState({ user: management });
    await expect(flowApi.submitWorkOrder(pendingId)).rejects.toMatchObject({ code: "forbidden" });
    useSession.setState({ user: hod });
    await expect(flowApi.submitWorkOrder(pendingId)).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("RFQ creation and sending", () => {
  beforeEach(() => {
    resetMockStore();
    useSession.setState({ user: hod });
  });
  const approved = mockId(20, 131);

  it("needs at least three eligible vendors per category", async () => {
    const vendors = getStore().vendors.filter((row) => row.categories.includes("Road / Civil"));
    const [keep] = vendors;
    await expect(flowApi.createRfqs(approved, { vendor_ids: [keep.id], due_date: "2026-12-01" })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("creates a draft that reaches vendors only after the HOD sends it", async () => {
    const created = await flowApi.createRfqs(approved, { due_date: "2026-12-01" });
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("DRAFT");
    const messagesBefore = getStore().messages.length;
    expect(messagesBefore).toBe(getStore().messages.length);
    const sent = await flowApi.sendRfq(created[0].id);
    expect(sent.status).toBe("SENT");
    expect(getStore().messages.length).toBeGreaterThan(messagesBefore);
    await expect(flowApi.sendRfq(created[0].id)).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("does not create RFQs for a requisition that is not approved", async () => {
    await expect(flowApi.createRfqs(mockId(20, 142), { due_date: "2026-12-01" })).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("repeat quotation submits create a new round and keep the old one", async () => {
    const before = (await flowApi.listQuotations(ROAD_RFQ)).filter((row) => row.vendor_id === mockId(50, 4)).length;
    await flowApi.createQuotation(ROAD_RFQ, {
      vendor_id: mockId(50, 4),
      quote_date: "2026-11-20",
      validity_days: 30,
      gst_pct: 18,
      gst_included: false,
      freight: 10000,
      payment_terms: "45 days",
      advance_pct: 0,
      start_days: 7,
      warranty: "24 months",
      escalation_clause: false,
      brands: [],
      remarks: null,
      items: [
        { rfq_item_id: PAVER, uom_quoted: "SQM", qty_quoted: 650, rate: 760 },
        { rfq_item_id: KERB, uom_quoted: "NOS", qty_quoted: 180, rate: 420 },
      ],
    });
    const after = (await flowApi.listQuotations(ROAD_RFQ)).filter((row) => row.vendor_id === mockId(50, 4));
    expect(after).toHaveLength(before + 1);
    expect(Math.max(...after.map((row) => row.round))).toBe(before + 1);
  });
});

describe("closing and cancelling follows the contract", () => {
  beforeEach(() => {
    resetMockStore();
    useSession.setState({ user: hod });
  });
  const pendingId = mockId(66, 1);

  it("closing an RFQ closes unselected vendor rows and conversations, once", async () => {
    const closed = await flowApi.closeRfq(ROAD_RFQ);
    expect(closed.status).toBe("CLOSED");
    expect(closed.vendors.every((row) => row.status === "CLOSED")).toBe(true);
    expect(getStore().conversations.filter((row) => row.rfq_id === ROAD_RFQ).every((row) => row.status === "closed")).toBe(true);
    expect(RfqSchema.safeParse(closed).success).toBe(true);
    await expect(flowApi.closeRfq(ROAD_RFQ)).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("the HOD cancels a Work Order before it is sent, with a reason", async () => {
    await expect(flowApi.cancelWorkOrder(pendingId, { reason: " " })).rejects.toMatchObject({ code: "validation_error" });
    const order = await flowApi.cancelWorkOrder(pendingId, { reason: "Vendor withdrew" });
    expect(order.status).toBe("CANCELLED");
    await expect(flowApi.cancelWorkOrder(pendingId, { reason: "again" })).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("once sent, only management can cancel", async () => {
    useSession.setState({ user: management });
    await flowApi.decideWorkOrder(pendingId, { action: "approve", note: "within budget" });
    await expect(flowApi.cancelWorkOrder(pendingId, { reason: "management only" })).resolves.toMatchObject({ status: "CANCELLED" });
    useSession.setState({ user: hod });
    resetMockStore();
    useSession.setState({ user: management });
    await expect(flowApi.cancelWorkOrder(pendingId, { reason: "not sent yet" })).rejects.toMatchObject({ code: "forbidden" });
    await flowApi.decideWorkOrder(pendingId, { action: "approve", note: "ok" });
    useSession.setState({ user: hod });
    await expect(flowApi.cancelWorkOrder(pendingId, { reason: "hod after send" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("only an acknowledged Work Order can be completed", async () => {
    await expect(flowApi.completeWorkOrder(pendingId)).rejects.toMatchObject({ code: "invalid_transition" });
    const order = getStore().workOrders.find((row) => row.id === pendingId);
    if (!order) throw new Error("seed work order missing");
    order.status = "ACKNOWLEDGED";
    await expect(flowApi.completeWorkOrder(pendingId)).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("cancelling a requisition closes its open RFQs, but not once a Work Order exists", async () => {
    const rfq = getStore().rfqs.find((row) => row.id === ROAD_RFQ);
    if (!rfq) throw new Error("seed rfq missing");
    const cancelled = await flowApi.cancelRequisition(rfq.requisition_id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(getStore().rfqs.find((row) => row.id === ROAD_RFQ)?.status).toBe("CLOSED");
    const withWo = getStore().workOrders.find((row) => row.id === pendingId);
    if (!withWo) throw new Error("seed work order missing");
    const requisition = getStore().requisitions.find((row) => row.id === withWo.requisition_id);
    if (requisition) requisition.status = "WO_GENERATED";
    await expect(flowApi.cancelRequisition(withWo.requisition_id)).rejects.toMatchObject({ code: "invalid_transition" });
  });
});
