"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./endpoints";
import type {
  AssignCodeInput,
  DecisionInput,
  PerformanceInput,
  Project,
  RequisitionStatus,
  VendorInput,
} from "./schemas";

const POLL_MS = 5_000;

export const queryKeys = {
  all: ["hod"] as const,
  projects: () => [...queryKeys.all, "projects"] as const,
  notifications: () => [...queryKeys.all, "notifications"] as const,
  stats: () => [...queryKeys.all, "stats"] as const,
  requisitions: () => [...queryKeys.all, "requisitions"] as const,
  requisitionList: (status: RequisitionStatus | "ALL") => [...queryKeys.requisitions(), "list", status] as const,
  requisition: (id: string) => [...queryKeys.requisitions(), "detail", id] as const,
  revisions: (id: string) => [...queryKeys.requisition(id), "revisions"] as const,
  stock: (id: string) => [...queryKeys.requisition(id), "stock"] as const,
  codeMatches: (id: string) => [...queryKeys.requisition(id), "codes"] as const,
  inventory: (projectId: string | "ALL") => [...queryKeys.all, "inventory", projectId] as const,
  vendors: (category: string | "ALL") => [...queryKeys.all, "vendors", category] as const,
  vendorsRoot: () => [...queryKeys.all, "vendors"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects(), queryFn: api.projects, staleTime: 5 * 60_000 });
}


export function useProjectLookup(): (id: string) => Project | undefined {
  const { data } = useProjects();
  return (id: string) => data?.find((row) => row.id === id);
}

/** Resolves a user id to a name from the real /users list. */
export function usePersonName(): (id: string) => string {
  const { data } = useQuery({ queryKey: [...queryKeys.all, "users"] as const, queryFn: () => api.users(), staleTime: 5 * 60_000 });
  return (id: string) => data?.find((row) => row.id === id)?.name ?? "Site engineer";
}

export function useNotifications() {
  return useQuery({ queryKey: queryKeys.notifications(), queryFn: api.notifications, refetchInterval: POLL_MS });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.markNotificationRead,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}

export function useDashboardStats() {
  return useQuery({ queryKey: queryKeys.stats(), queryFn: api.dashboardStats, refetchInterval: POLL_MS });
}

export function useRequisitions(status: RequisitionStatus | "ALL", options?: { poll?: boolean }) {
  return useQuery({
    queryKey: queryKeys.requisitionList(status),
    queryFn: () => api.requisitions(status === "ALL" ? undefined : status),
    refetchInterval: options?.poll ? POLL_MS : false,
  });
}

export function useRequisition(id: string) {
  return useQuery({ queryKey: queryKeys.requisition(id), queryFn: () => api.requisition(id) });
}

export function useRevisions(id: string) {
  return useQuery({ queryKey: queryKeys.revisions(id), queryFn: () => api.revisions(id) });
}

export function useStockCheck(id: string) {
  return useQuery({ queryKey: queryKeys.stock(id), queryFn: () => api.stockCheck(id) });
}

export function useMatchCodes(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.matchCodes(id),
    onSuccess: (data) => client.setQueryData(queryKeys.codeMatches(id), data),
  });
}

export function useAssignCode(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: AssignCodeInput }) => api.assignCode(id, itemId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.requisition(id) }),
  });
}

export function useDecision(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: DecisionInput) => api.decide(id, input),
    onSuccess: (requisition) => client.setQueryData(queryKeys.requisition(id), requisition),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.requisitions() }),
        client.invalidateQueries({ queryKey: queryKeys.stats() }),
        client.invalidateQueries({ queryKey: [...queryKeys.all, "inventory"] }),
      ]),
  });
}

export function useInventory(projectId: string | "ALL") {
  return useQuery({
    queryKey: queryKeys.inventory(projectId),
    queryFn: () => api.inventory(projectId === "ALL" ? undefined : projectId),
  });
}

export function useVendors(category: string | "ALL") {
  return useQuery({
    queryKey: queryKeys.vendors(category),
    queryFn: () => api.vendors(category === "ALL" ? undefined : category),
  });
}

export function useSaveVendor() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: VendorInput }) =>
      id ? api.updateVendor(id, input) : api.createVendor(input),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.vendorsRoot() }),
  });
}

export function useSetVendorStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "blocked" }) => api.updateVendor(id, { status }),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.vendorsRoot() }),
  });
}

export function useAddPerformance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PerformanceInput }) => api.addPerformance(id, input),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.vendorsRoot() }),
  });
}

export function useFile(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.all, "file", id ?? "none"] as const,
    queryFn: () => (id ? api.file(id) : Promise.resolve(null)),
    enabled: id !== null,
    staleTime: Infinity,
  });
}
