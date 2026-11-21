import { z } from "zod";
import { apiFetch, apiFetchBlob } from "./client";
import { isMocked } from "./mode";
import { mockApi } from "./mocks/handlers";
import {
  DashboardStatsSchema,
  InventoryRowSchema,
  LoginResponseSchema,
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
  type LoginInput,
  type PerformanceInput,
  type RequisitionStatus,
  type VendorInput,
} from "./schemas";

const NoContent = z.undefined();
const enc = encodeURIComponent;

export const api = {
  login: (input: LoginInput) =>
    apiFetch("/auth/login", { method: "POST", body: input, schema: LoginResponseSchema, auth: false }),

  me: () => apiFetch("/me", { schema: UserSchema }),

  projects: () => apiFetch("/projects", { schema: z.array(ProjectSchema) }),

  notifications: () => apiFetch("/notifications", { schema: z.array(NotificationSchema) }),

  markNotificationRead: (id: string) =>
    apiFetch(`/notifications/${enc(id)}/read`, { method: "POST", schema: NoContent }),

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

  addPerformance: (id: string, input: PerformanceInput) =>
    isMocked("vendors.performance")
      ? mockApi.addPerformance(id, input)
      : apiFetch(`/vendors/${enc(id)}/performance`, { method: "POST", body: input, schema: z.unknown() }).then(() => undefined),

  file: (id: string): Promise<Blob | null> => (isMocked("files.get") ? Promise.resolve(null) : apiFetchBlob(`/files/${enc(id)}`)),
};
