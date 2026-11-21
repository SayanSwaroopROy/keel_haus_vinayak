"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./endpoints";
import { queryKeys } from "./hooks";
import type { Role } from "./schemas";
import type {
  AlternativeDecisionInput,
  EvalWeights,
  QuotationInput,
  QuotationPatch,
  RegistrationInput,
  RevisionRequestInput,
  RfqCreateInput,
  SelectionInput,
  WoApprovalInput,
  WoCancelInput,
} from "./schemas-flow";

const CHAT_LIST_MS = 3_000;
const CHAT_MESSAGES_MS = 2_000;
const BOARD_MS = 5_000;

export const flowKeys = {
  users: (role: Role | "ALL") => [...queryKeys.all, "users", role] as const,
  rfqs: () => [...queryKeys.all, "rfqs"] as const,
  rfq: (id: string) => [...flowKeys.rfqs(), id] as const,
  quotations: (rfqId: string) => [...flowKeys.rfq(rfqId), "quotations"] as const,
  evaluation: (rfqId: string) => [...flowKeys.rfq(rfqId), "evaluation"] as const,
  alternatives: (rfqId: string) => [...flowKeys.rfq(rfqId), "alternatives"] as const,
  conversations: () => [...queryKeys.all, "conversations"] as const,
  messages: (id: string) => [...flowKeys.conversations(), id, "messages"] as const,
  workOrders: () => [...queryKeys.all, "work-orders"] as const,
  workOrder: (id: string) => [...flowKeys.workOrders(), id] as const,
};

export function useUsers(role?: Role) {
  return useQuery({ queryKey: flowKeys.users(role ?? "ALL"), queryFn: () => api.users(role), staleTime: 5 * 60_000 });
}

export function useRfqs() {
  return useQuery({ queryKey: flowKeys.rfqs(), queryFn: api.rfqs, refetchInterval: BOARD_MS });
}

export function useRfq(id: string) {
  return useQuery({ queryKey: [...flowKeys.rfq(id), "detail"] as const, queryFn: () => api.rfq(id), refetchInterval: BOARD_MS });
}

export function useCreateRfqs(requisitionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RfqCreateInput) => api.createRfqs(requisitionId, input),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: flowKeys.rfqs() }),
        client.invalidateQueries({ queryKey: queryKeys.requisitions() }),
      ]),
  });
}

export function useSendRfq() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.sendRfq(id),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: flowKeys.rfqs() }),
        client.invalidateQueries({ queryKey: flowKeys.conversations() }),
        client.invalidateQueries({ queryKey: queryKeys.requisitions() }),
        client.invalidateQueries({ queryKey: queryKeys.stats() }),
      ]),
  });
}

export function useQuotations(rfqId: string) {
  return useQuery({ queryKey: flowKeys.quotations(rfqId), queryFn: () => api.quotations(rfqId), refetchInterval: BOARD_MS });
}

function useInvalidateRfq(rfqId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: flowKeys.rfq(rfqId) }),
      client.invalidateQueries({ queryKey: flowKeys.rfqs() }),
      client.invalidateQueries({ queryKey: flowKeys.conversations() }),
      client.invalidateQueries({ queryKey: queryKeys.stats() }),
    ]);
}

export function useCreateQuotation(rfqId: string) {
  const invalidate = useInvalidateRfq(rfqId);
  return useMutation({ mutationFn: (input: QuotationInput) => api.createQuotation(rfqId, input), onSettled: invalidate });
}

export function usePatchQuotation(rfqId: string) {
  const invalidate = useInvalidateRfq(rfqId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuotationPatch }) => api.patchQuotation(id, input),
    onSettled: invalidate,
  });
}

export function useRequestRevision(rfqId: string) {
  const invalidate = useInvalidateRfq(rfqId);
  return useMutation({ mutationFn: (input: RevisionRequestInput) => api.requestRevision(rfqId, input), onSettled: invalidate });
}

export function useEvaluation(rfqId: string) {
  return useQuery({
    queryKey: flowKeys.evaluation(rfqId),
    queryFn: () => api.evaluation(rfqId),
    retry: false,
  });
}

export function useCreateEvaluation(rfqId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (weights?: EvalWeights) => api.createEvaluation(rfqId, weights),
    onSuccess: (data) => client.setQueryData(flowKeys.evaluation(rfqId), data),
  });
}

export function useSelectVendors(rfqId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRfq(rfqId);
  return useMutation({
    mutationFn: ({ evaluationId, input }: { evaluationId: string; input: SelectionInput }) => api.select(evaluationId, input),
    onSuccess: (data) => client.setQueryData(flowKeys.evaluation(rfqId), data),
    onSettled: () => Promise.all([invalidate(), client.invalidateQueries({ queryKey: queryKeys.requisitions() })]),
  });
}

export function useAlternatives(rfqId: string) {
  return useQuery({ queryKey: flowKeys.alternatives(rfqId), queryFn: () => api.alternatives(rfqId), refetchInterval: BOARD_MS });
}

export function useDecideAlternative(rfqId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateRfq(rfqId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AlternativeDecisionInput }) => api.decideAlternative(id, input),
    onSettled: () => Promise.all([invalidate(), client.invalidateQueries({ queryKey: flowKeys.alternatives(rfqId) })]),
  });
}

export function useConversations() {
  return useQuery({ queryKey: flowKeys.conversations(), queryFn: api.conversations, refetchInterval: CHAT_LIST_MS });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: flowKeys.messages(conversationId ?? "none"),
    queryFn: () => api.messages(conversationId ?? ""),
    enabled: conversationId !== null,
    refetchInterval: CHAT_MESSAGES_MS,
  });
}

export function useSendMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ text, rfqItemId }: { text: string; rfqItemId: string | null }) => api.sendMessage(conversationId, text, rfqItemId),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: flowKeys.messages(conversationId) }),
        client.invalidateQueries({ queryKey: flowKeys.conversations() }),
      ]),
  });
}

export function useWorkOrders() {
  return useQuery({ queryKey: flowKeys.workOrders(), queryFn: api.workOrders, refetchInterval: BOARD_MS });
}

export function useWorkOrder(id: string) {
  return useQuery({ queryKey: [...flowKeys.workOrder(id), "detail"] as const, queryFn: () => api.workOrder(id), refetchInterval: BOARD_MS });
}

function useInvalidateWorkOrders() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: flowKeys.workOrders() }),
      client.invalidateQueries({ queryKey: queryKeys.notifications() }),
      client.invalidateQueries({ queryKey: queryKeys.requisitions() }),
      client.invalidateQueries({ queryKey: queryKeys.stats() }),
    ]);
}

export function useCreateWorkOrders(rfqId: string) {
  const invalidate = useInvalidateWorkOrders();
  const invalidateRfq = useInvalidateRfq(rfqId);
  return useMutation({
    mutationFn: (evaluationId: string) => api.createWorkOrders(evaluationId),
    onSettled: () => Promise.all([invalidate(), invalidateRfq()]),
  });
}

export function useSubmitWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: (id: string) => api.submitWorkOrder(id), onSettled: invalidate });
}

export function useDecideWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WoApprovalInput }) => api.decideWorkOrder(id, input),
    onSettled: invalidate,
  });
}

export function useCompleteWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: (id: string) => api.completeWorkOrder(id), onSettled: invalidate });
}

export function useCancelWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: WoCancelInput }) => api.cancelWorkOrder(id, input),
    onSettled: invalidate,
  });
}

export function useCloseRfq(rfqId: string) {
  const invalidateRfq = useInvalidateRfq(rfqId);
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.closeRfq(rfqId),
    onSettled: () => Promise.all([invalidateRfq(), client.invalidateQueries({ queryKey: flowKeys.conversations() })]),
  });
}

export function useCancelRequisition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelRequisition(id),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.requisitions() }),
        client.invalidateQueries({ queryKey: flowKeys.rfqs() }),
        client.invalidateQueries({ queryKey: queryKeys.stats() }),
      ]),
  });
}

export function useSetRegistration() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RegistrationInput }) => api.setRegistration(id, input),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.vendorsRoot() }),
  });
}
