import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, fromThrown, parseErrorBody } from "./errors";
import {
  MOCK_INVENTORY,
  MOCK_PROJECTS,
  MOCK_REQUISITIONS,
  MOCK_REVISIONS,
  MOCK_VENDORS,
} from "./mocks/fixtures";
import { mockApi, resetMockStore } from "./mocks/handlers";
import {
  InventoryRowSchema,
  ProjectSchema,
  RequisitionSchema,
  RevisionSchema,
  StockRowSchema,
  VendorSchema,
} from "./schemas";
import { EvaluationSchema, RfqVendorSchema } from "./schemas-flow";

describe("mock fixtures match the API contract", () => {
  it.each([
    ["projects", z.array(ProjectSchema), MOCK_PROJECTS],
    ["requisitions", z.array(RequisitionSchema), MOCK_REQUISITIONS],
    ["revisions", z.array(RevisionSchema), Object.values(MOCK_REVISIONS).flat()],
    ["inventory", z.array(InventoryRowSchema), MOCK_INVENTORY],
    ["vendors", z.array(VendorSchema), MOCK_VENDORS],
  ])("%s parse", (_name, schema, data) => {
    const result = schema.safeParse(data);
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
  });

  it("never guesses: a missing quantity or unit stays null and is flagged", () => {
    const items = MOCK_REQUISITIONS.flatMap((row) => row.items);
    for (const item of items.filter((row) => row.quantity === null || row.uom === null)) {
      expect(item.uncertain_fields.length).toBeGreaterThan(0);
      expect(item.clarification_question).not.toBeNull();
    }
  });

  it("a vendor is registered exactly when every checklist item is done", () => {
    for (const vendor of MOCK_VENDORS) {
      expect(vendor.registered).toBe(vendor.registration_checklist.every((row) => row.done));
    }
  });
});

describe("error parsing", () => {
  it("maps the contract error body", () => {
    const error = parseErrorBody(409, { error: { code: "invalid_transition", message: "nope", details: [] } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("invalid_transition");
    expect(error.status).toBe(409);
  });

  it("treats an unknown body as a bad response", () => {
    expect(parseErrorBody(400, "<html>").code).toBe("bad_response");
    expect(parseErrorBody(502, null).code).toBe("internal");
  });

  it("maps an unknown error code to internal", () => {
    expect(parseErrorBody(500, { error: { code: "weird", message: "x" } }).code).toBe("internal");
  });

  it("maps timeouts and network failures", () => {
    expect(fromThrown(new DOMException("t", "TimeoutError")).code).toBe("timeout");
    expect(fromThrown(new TypeError("Failed to fetch")).code).toBe("network_error");
  });
});

describe("mock decision flow", () => {
  beforeEach(() => resetMockStore());

  const pending = () => {
    const found = MOCK_REQUISITIONS.find((row) => row.status === "PENDING_APPROVAL");
    if (!found) throw new Error("fixture missing");
    return found;
  };

  it("approve moves PENDING_APPROVAL to APPROVED and reserves available stock", async () => {
    const requisition = pending();
    const before = await mockApi.stockCheck(requisition.id);
    const updated = await mockApi.decide(requisition.id, { action: "approve", note: "ok for roof" });
    expect(updated.status).toBe("APPROVED");
    const after = await mockApi.stockCheck(requisition.id);
    const cementBefore = before.find((row) => row.material === "Cement");
    const cementAfter = after.find((row) => row.material === "Cement");
    expect(cementBefore && cementAfter && cementAfter.reserved).toBe((cementBefore?.reserved ?? 0) + (cementBefore?.requested ?? 0));
  });

  it("refuses a second decision with invalid_transition", async () => {
    const requisition = pending();
    await mockApi.decide(requisition.id, { action: "reject", note: "duplicate" });
    await expect(mockApi.decide(requisition.id, { action: "approve", note: "again" })).rejects.toMatchObject({
      code: "invalid_transition",
      status: 409,
    });
  });

  it("stock rows satisfy the formula and skip work items", async () => {
    for (const requisition of MOCK_REQUISITIONS) {
      const rows = z.array(StockRowSchema).parse(await mockApi.stockCheck(requisition.id));
      for (const row of rows) {
        expect(row.available).toBe(Math.max(0, row.physical - row.reserved));
        expect(row.to_procure).toBe(Math.max(0, row.requested - row.available));
        const item = requisition.items.find((line) => line.id === row.req_item_id);
        expect(item?.kind).toBe("material");
      }
    }
  });
});

describe("schemas accept what the real backend returns", () => {
  it("a real stock row with a flag and a converted unit", () => {
    const row = {
      req_item_id: "00000000-0000-4000-8000-000000000001",
      material: "Cement",
      uom: "BAG",
      kind: "material",
      requested: 100,
      physical: 40,
      reserved: 0,
      available: 40,
      to_procure: 60,
      is_dummy: false,
      flag: "unit_converted",
      requested_original: { qty: 5, uom: "MT" },
    };
    expect(StockRowSchema.safeParse(row).success).toBe(true);
    expect(StockRowSchema.safeParse({ ...row, flag: "something_new" }).success).toBe(false);
  });

  it("RFQ vendor rows can be DRAFT, CLOSED or CANCELLED", () => {
    for (const status of ["DRAFT", "CLOSED", "CANCELLED"]) {
      const result = RfqVendorSchema.safeParse({ vendor_id: "00000000-0000-4000-8000-000000000002", vendor_name: "V", status, viewed_at: null });
      expect(result.success, status).toBe(true);
    }
  });

  it("a recommendation may have no vendor for a line and carries its source", () => {
    const shape = EvaluationSchema.shape.recommendation;
    const ok = shape.safeParse({
      overall_vendor_id: null,
      per_item: [{ rfq_item_id: "00000000-0000-4000-8000-000000000003", vendor_id: null, reasoning: "No clean quote" }],
      reasoning: "Nothing to recommend",
      basis: "table",
      source: "fallback",
    });
    expect(ok.success).toBe(true);
    expect(shape.safeParse({ overall_vendor_id: null, per_item: [], reasoning: "", basis: "", source: "magic" }).success).toBe(false);
  });
});
