import { ApiError } from "../errors";
import type {
  AssignCodeInput,
  DashboardStats,
  DecisionInput,
  InventoryRow,
  MatchCodesResponse,
  PerformanceInput,
  ReqItem,
  Requisition,
  RequisitionStatus,
  Revision,
  StockRow,
  Vendor,
  VendorInput,
} from "../schemas";
import {
  MOCK_CODE_MATCHES,
  MOCK_INVENTORY,
  MOCK_NEW_CODE_SUGGESTIONS,
  MOCK_REQUISITIONS,
  MOCK_REVISIONS,
  MOCK_VENDORS,
  RFQ_TEST_INBOX_LABEL,
  mockId,
} from "./fixtures";

const LATENCY_MS = 280;

type Store = {
  requisitions: Requisition[];
  revisions: Record<string, Revision[]>;
  inventory: InventoryRow[];
  vendors: Vendor[];
  nextVendor: number;
};

const freshStore = (): Store => structuredClone({
  requisitions: MOCK_REQUISITIONS,
  revisions: MOCK_REVISIONS,
  inventory: MOCK_INVENTORY,
  vendors: MOCK_VENDORS,
  nextVendor: MOCK_VENDORS.length + 1,
});

let store: Store = freshStore();

export function resetMockStore(): void {
  store = freshStore();
}

const delay = async <T>(value: T, latency = LATENCY_MS): Promise<T> => {
  if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
  return structuredClone(value);
};

const findRequisition = (id: string): Requisition => {
  const requisition = store.requisitions.find((row) => row.id === id);
  if (!requisition) throw new ApiError(404, "not_found", "Requisition not found");
  return requisition;
};

const sameMaterial = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function stockRowsFor(requisition: Requisition): StockRow[] {
  return requisition.items
    .filter((row): row is ReqItem & { quantity: number; uom: NonNullable<ReqItem["uom"]> } =>
      row.kind === "material" && row.quantity !== null && row.uom !== null,
    )
    .map((row) => {
      const stock = store.inventory.find(
        (inv) => inv.project_id === requisition.project_id && sameMaterial(inv.material, row.description) && inv.uom === row.uom,
      );
      const physical = stock?.physical ?? 0;
      const reserved = stock?.reserved ?? 0;
      const available = Math.max(0, physical - reserved);
      return {
        req_item_id: row.id,
        material: row.description,
        uom: row.uom,
        requested: row.quantity,
        physical,
        reserved,
        available,
        to_procure: Math.max(0, row.quantity - available),
        is_dummy: true as const,
      };
    });
}

const PENDING: ReadonlySet<RequisitionStatus> = new Set(["PENDING_APPROVAL"]);

export const mockApi = {
  async dashboardStats(): Promise<DashboardStats> {
    const rows = store.requisitions;
    const count = (statuses: RequisitionStatus[]) => rows.filter((row) => statuses.includes(row.status)).length;
    return delay({
      requisitions: {
        total: rows.length,
        pending: count(["PENDING_APPROVAL"]),
        approved: count(["APPROVED", "RFQ_FLOATED", "UNDER_EVALUATION", "VENDOR_SELECTED", "WO_GENERATED", "ORDER_PLACED", "COMPLETED"]),
        rejected: count(["REJECTED"]),
      },
      rfqs_active: 0,
      pending_vendor_responses: 0,
      pending_quotations: 0,
      orders_placed: 0,
      spend_total: 0,
    });
  },

  async listRequisitions(status?: RequisitionStatus): Promise<Requisition[]> {
    const rows = status ? store.requisitions.filter((row) => row.status === status) : store.requisitions;
    return delay([...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },

  async getRequisition(id: string): Promise<Requisition> {
    return delay(findRequisition(id));
  },

  async getRevisions(id: string): Promise<Revision[]> {
    const requisition = findRequisition(id);
    const revisions = store.revisions[id] ?? [
      {
        version: 1,
        actor: "ai" as const,
        change_note: "Original AI extraction",
        items: requisition.items,
        created_at: requisition.created_at,
      },
    ];
    return delay(revisions);
  },

  async matchCodes(id: string): Promise<MatchCodesResponse> {
    const requisition = findRequisition(id);
    return delay(
      {
        items: requisition.items.map((row) => ({
          item_id: row.id,
          matches: MOCK_CODE_MATCHES[row.id] ?? [],
          duplicates: row.duplicate_of,
          new_code_suggestion: MOCK_NEW_CODE_SUGGESTIONS[row.id] ?? row.new_code_suggestion,
        })),
      },
      900,
    );
  },

  async assignCode(id: string, itemId: string, input: AssignCodeInput): Promise<ReqItem> {
    const requisition = findRequisition(id);
    const target = requisition.items.find((row) => row.id === itemId);
    if (!target) throw new ApiError(404, "not_found", "Item not found");
    target.item_code = "item_code" in input ? input.item_code : input.new_code;
    target.duplicate_of = [];
    return delay(target);
  },

  async stockCheck(id: string): Promise<StockRow[]> {
    return delay(stockRowsFor(findRequisition(id)));
  },

  async decide(id: string, input: DecisionInput): Promise<Requisition> {
    const requisition = findRequisition(id);
    if (!PENDING.has(requisition.status)) {
      throw new ApiError(409, "invalid_transition", `Cannot ${input.action} a requisition in ${requisition.status}`);
    }
    if (input.action === "approve") {
      for (const row of stockRowsFor(requisition)) {
        const stock = store.inventory.find(
          (inv) => inv.project_id === requisition.project_id && sameMaterial(inv.material, row.material) && inv.uom === row.uom,
        );
        if (!stock) continue;
        stock.reserved += Math.min(row.requested, row.available);
        stock.available = stock.physical - stock.reserved;
      }
    }
    const next: Record<DecisionInput["action"], RequisitionStatus> = {
      approve: "APPROVED",
      reject: "REJECTED",
      clarify: "CLARIFICATION_REQUIRED",
    };
    requisition.status = next[input.action];
    return delay(requisition);
  },

  async listInventory(projectId?: string): Promise<InventoryRow[]> {
    const rows = projectId ? store.inventory.filter((row) => row.project_id === projectId) : store.inventory;
    return delay(rows);
  },

  async listVendors(category?: string): Promise<Vendor[]> {
    const rows = category ? store.vendors.filter((row) => row.categories.includes(category)) : store.vendors;
    return delay(rows);
  },

  async createVendor(input: VendorInput): Promise<Vendor> {
    if (store.vendors.some((row) => sameMaterial(row.name, input.name))) {
      throw new ApiError(409, "conflict", "A vendor with this name already exists");
    }
    const vendor: Vendor = {
      id: mockId(50, store.nextVendor),
      ...input,
      category_source: "manual",
      contact_email: RFQ_TEST_INBOX_LABEL,
      performance: null,
    };
    store.nextVendor += 1;
    store.vendors.push(vendor);
    return delay(vendor);
  },

  async updateVendor(id: string, input: Partial<VendorInput>): Promise<Vendor> {
    const vendor = store.vendors.find((row) => row.id === id);
    if (!vendor) throw new ApiError(404, "not_found", "Vendor not found");
    Object.assign(vendor, input, input.categories ? { category_source: "manual" } : {});
    return delay(vendor);
  },

  async addPerformance(id: string, input: PerformanceInput): Promise<void> {
    const vendor = store.vendors.find((row) => row.id === id);
    if (!vendor) throw new ApiError(404, "not_found", "Vendor not found");
    const previous = vendor.performance && !vendor.performance.is_dummy ? vendor.performance : null;
    const n = (previous?.n ?? 0) + 1;
    const blend = (old: number | undefined, next: number) => (old === undefined ? next : (old * (n - 1) + next) / n);
    vendor.performance = {
      quality: blend(previous?.quality, input.quality),
      delivery: blend(previous?.delivery, input.delivery),
      disputes: blend(previous?.disputes, input.disputes),
      n,
      is_dummy: false,
    };
    await delay(null);
  },
};
