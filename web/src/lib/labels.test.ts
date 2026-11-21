import { describe, expect, it } from "vitest";
import { RequisitionStatusSchema } from "./api/schemas";
import { DECISION_LABELS, NAV_LABELS, STATUS_LABELS } from "./i18n/labels";
import { formatQty, reqNumber } from "./format";
import { requisitionBlockers } from "./requisition";
import type { ReqItem, Requisition } from "./api/schemas";

const BENGALI = /[ঀ-৿]/;
const DEVANAGARI = /[ऀ-ॿ]/;

describe("trilingual labels", () => {
  it("cover every requisition status in en, bn and hi", () => {
    for (const status of RequisitionStatusSchema.options) {
      const label = STATUS_LABELS[status];
      expect(label.en.length).toBeGreaterThan(0);
      expect(label.bn).toMatch(BENGALI);
      expect(label.hi).toMatch(DEVANAGARI);
    }
  });

  it("cover navigation and decisions in the right scripts", () => {
    for (const label of [...Object.values(NAV_LABELS), ...Object.values(DECISION_LABELS)]) {
      expect(label.bn).toMatch(BENGALI);
      expect(label.hi).toMatch(DEVANAGARI);
    }
  });
});

describe("display helpers", () => {
  it("shows null quantities as a dash, never zero", () => {
    expect(formatQty(null)).toBe("—");
    expect(formatQty(4200)).toBe("4,200");
  });

  it("derives a stable short requisition number", () => {
    expect(reqNumber("00000000-0000-4000-8000-000020000142")).toBe("REQ-0142");
  });

  it("flags unsure and duplicate lines as blockers", () => {
    const item = (over: Partial<ReqItem>) => ({ quantity: 1, uom: "nos", uncertain_fields: [], duplicate_of: [], item_code: "X", ...over }) as ReqItem;
    const roof = { items: [item({ uncertain_fields: ["quantity"] }), item({ duplicate_of: [{ code: "a", description: "a", reason: "a" }] })] } as unknown as Requisition;
    const kinds = requisitionBlockers(roof).map((blocker) => blocker.kind);
    expect(kinds).toContain("unsure");
    expect(kinds).toContain("duplicate");
  });
});
