import { describe, expect, it } from "vitest";
import { RequisitionStatusSchema } from "./api/schemas";
import { DECISION_LABELS, NAV_LABELS, STATUS_LABELS } from "./i18n/labels";
import { formatQty, reqNumber } from "./format";
import { requisitionBlockers } from "./requisition";
import { MOCK_REQUISITIONS } from "./api/mocks/fixtures";

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
    const roof = MOCK_REQUISITIONS[0];
    const kinds = requisitionBlockers(roof).map((blocker) => blocker.kind);
    expect(kinds).toContain("unsure");
    expect(kinds).toContain("duplicate");
  });
});
