import { ApiError } from "../errors";
import type {
  InventoryRow,
  Notification,
  Requisition,
  Revision,
  Vendor,
} from "../schemas";
import type { Alternative, Conversation, Message, Quotation, Rfq, WorkOrder, EvalWeights } from "../schemas-flow";
import {
  MOCK_INVENTORY,
  MOCK_REQUISITIONS,
  MOCK_REVISIONS,
  MOCK_VENDORS,
  mockId,
} from "./fixtures";
import { MOCK_NOW } from "./quote-logic";
import { seedFlow } from "./seed-flow";

export { MOCK_NOW };

export const LATENCY_MS = 280;


export type EvaluationState = {
  id: string;
  rfq_id: string;
  weights: EvalWeights;
  selections: Array<{ rfq_item_id: string; vendor_id: string }> | null;
  note: string | null;
};

export type Store = {
  requisitions: Requisition[];
  revisions: Record<string, Revision[]>;
  inventory: InventoryRow[];
  vendors: Vendor[];
  nextVendor: number;
  rfqs: Rfq[];
  quotations: Quotation[];
  evaluations: EvaluationState[];
  alternatives: Alternative[];
  conversations: Conversation[];
  messages: Message[];
  workOrders: WorkOrder[];
  notifications: Array<Notification & { audience: "hod" | "management" }>;
  counters: Record<number, number>;
};

const freshStore = (): Store => {
  const base = structuredClone({
    requisitions: MOCK_REQUISITIONS,
    revisions: MOCK_REVISIONS,
    inventory: MOCK_INVENTORY,
    vendors: MOCK_VENDORS,
    nextVendor: MOCK_VENDORS.length + 1,
  });
  const flow = seedFlow(base.requisitions, base.vendors);
  return { ...base, ...flow, counters: {} };
};

let current: Store = freshStore();

export const getStore = (): Store => current;

export function resetMockStore(): void {
  current = freshStore();
}

export const delay = async <T>(value: T, latency = LATENCY_MS): Promise<T> => {
  if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
  return structuredClone(value);
};

/** Ids for rows created at runtime; seeds use low sequence numbers, so these start high. */
export function nextId(group: number): string {
  const store = getStore();
  const next = (store.counters[group] ?? 500) + 1;
  store.counters[group] = next;
  return mockId(group, next);
}

export function notify(audience: "hod" | "management", type: string, refType: string, refId: string, title: string): void {
  getStore().notifications.unshift({
    id: nextId(67),
    type,
    ref_type: refType,
    ref_id: refId,
    title,
    created_at: new Date().toISOString(),
    audience,
    read_at: null,
  });
}

export const findRfq = (id: string): Rfq => {
  const rfq = getStore().rfqs.find((row) => row.id === id);
  if (!rfq) throw new ApiError(404, "not_found", "RFQ not found");
  return rfq;
};

export const findVendor = (id: string): Vendor => {
  const vendor = getStore().vendors.find((row) => row.id === id);
  if (!vendor) throw new ApiError(404, "not_found", "Vendor not found");
  return vendor;
};
