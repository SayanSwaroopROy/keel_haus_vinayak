import { useSession } from "../../auth/session";
import type { RegistrationInput } from "../schemas-flow";
import { ApiError } from "../errors";
import type {
  AssignCodeInput,
  DashboardStats,
  DecisionInput,
  InventoryRow,
  MatchCodesResponse,
  Notification,
  PerformanceInput,
  Project,
  Role,
  ReqItem,
  Requisition,
  RequisitionStatus,
  Revision,
  StockRow,
  User,
  Vendor,
  VendorInput,
} from "../schemas";
import { MOCK_CODE_MATCHES, MOCK_NEW_CODE_SUGGESTIONS, MOCK_PROJECTS, MOCK_USERS, REGISTRATION_LABELS, mockId } from "./fixtures";
import { delay, getStore, resetMockStore } from "./store";

export { resetMockStore };

const findRequisition = (id: string): Requisition => {
  const requisition = getStore().requisitions.find((row) => row.id === id);
  if (!requisition) throw new ApiError(404, "not_found", "Requisition not found");
  return requisition;
};

const sameMaterial = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function stockRowsFor(requisition: Requisition): StockRow[] {
  return requisition.items
    .filter((row): row is ReqItem & { quantity: number; uom: NonNullable<ReqItem["uom"]> } =>
      row.kind === "material" && row.quantity !== null && row.uom !== null,
    )
    .map((row) => {
      const stock = getStore().inventory.find(
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
    const rows = getStore().requisitions;
    const openRfqs = getStore().rfqs.filter((rfq) => rfq.status === "SENT");
    const placed = getStore().workOrders.filter((row) => ["SENT", "ACKNOWLEDGED", "COMPLETED"].includes(row.status));
    const count = (statuses: RequisitionStatus[]) => rows.filter((row) => statuses.includes(row.status)).length;
    return delay({
      requisitions: {
        total: rows.length,
        pending: count(["PENDING_APPROVAL"]),
        approved: count(["APPROVED", "RFQ_FLOATED", "UNDER_EVALUATION", "VENDOR_SELECTED", "WO_GENERATED", "ORDER_PLACED", "COMPLETED"]),
        rejected: count(["REJECTED"]),
      },
      rfqs_active: openRfqs.length,
      pending_vendor_responses: openRfqs.flatMap((rfq) => rfq.vendors).filter((row) => row.status === "RFQ_SENT" || row.status === "RFQ_VIEWED").length,
      pending_quotations: openRfqs.flatMap((rfq) => rfq.vendors).filter((row) => row.status !== "QUOTATION_SUBMITTED" && row.status !== "REVISION_REQUESTED").length,
      orders_placed: placed.length,
      spend_total: placed.reduce((sum, row) => sum + row.total, 0),
    });
  },

  async listUsers(role?: Role): Promise<User[]> {
    return delay(role ? MOCK_USERS.filter((row) => row.role === role) : MOCK_USERS, 120);
  },

  async listProjects(): Promise<Project[]> {
    return delay(MOCK_PROJECTS, 120);
  },

  async listNotifications(): Promise<Notification[]> {
    const audience = useSession.getState().user?.role === "management" ? "management" : "hod";
    return delay(
      getStore()
        .notifications.filter((row) => row.audience === audience)
        .map((row) => ({ id: row.id, type: row.type, ref_type: row.ref_type, ref_id: row.ref_id, title: row.title, created_at: row.created_at, read_at: row.read_at })),
      120,
    );
  },

  async markNotificationRead(id: string): Promise<void> {
    const row = getStore().notifications.find((entry) => entry.id === id);
    if (row) row.read_at = new Date().toISOString();
    await delay(null, 60);
  },

  async setRegistration(id: string, input: RegistrationInput): Promise<Vendor> {
    const vendor = getStore().vendors.find((row) => row.id === id);
    if (!vendor) throw new ApiError(404, "not_found", "Vendor not found");
    vendor.registration_checklist = input.checklist;
    vendor.registered = input.checklist.length > 0 && input.checklist.every((row) => row.done);
    return delay(vendor);
  },

  async listRequisitions(status?: RequisitionStatus): Promise<Requisition[]> {
    const rows = status ? getStore().requisitions.filter((row) => row.status === status) : getStore().requisitions;
    return delay([...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  },

  async getRequisition(id: string): Promise<Requisition> {
    return delay(findRequisition(id));
  },

  async getRevisions(id: string): Promise<Revision[]> {
    const requisition = findRequisition(id);
    const revisions = getStore().revisions[id] ?? [
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
        const stock = getStore().inventory.find(
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
    const rows = projectId ? getStore().inventory.filter((row) => row.project_id === projectId) : getStore().inventory;
    return delay(rows);
  },

  async listVendors(category?: string): Promise<Vendor[]> {
    const rows = category ? getStore().vendors.filter((row) => row.categories.includes(category)) : getStore().vendors;
    return delay(rows);
  },

  async createVendor(input: VendorInput): Promise<Vendor> {
    if (getStore().vendors.some((row) => sameMaterial(row.name, input.name))) {
      throw new ApiError(409, "conflict", "A vendor with this name already exists");
    }
    const vendor: Vendor = {
      id: mockId(50, getStore().nextVendor),
      ...input,
      category_source: "manual",
      registered: false,
      registration_checklist: REGISTRATION_LABELS.map((label) => ({ label, done: false })),
      performance: null,
    };
    getStore().nextVendor += 1;
    getStore().vendors.push(vendor);
    return delay(vendor);
  },

  async updateVendor(id: string, input: Partial<VendorInput>): Promise<Vendor> {
    const vendor = getStore().vendors.find((row) => row.id === id);
    if (!vendor) throw new ApiError(404, "not_found", "Vendor not found");
    Object.assign(vendor, input, input.categories ? { category_source: "manual" } : {});
    return delay(vendor);
  },

  async addPerformance(id: string, input: PerformanceInput): Promise<void> {
    const vendor = getStore().vendors.find((row) => row.id === id);
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
