import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useIdentity } from '@/lib/identity';
import { usePollInterval } from '@/lib/use-poll';

import { api, type UploadFile } from './endpoints';
import { queryKeys } from './hooks';
import type { Alternative, AlternativeInput, AlternativeReplyInput, Conversation, Quotation, QuotationInput, Rfq, RfqVendor, WorkOrder } from './schemas-vendor';

const RFQ_POLL_MS = 10_000;
const CONVERSATION_POLL_MS = 5_000;
const MESSAGE_POLL_MS = 2_000;
const NO_ALTERNATIVES: Alternative[] = [];

function useScope(): { userId: string | null; vendorId: string | null } {
  const userId = useIdentity((state) => state.user?.id ?? null);
  const vendorId = useIdentity((state) => state.user?.vendor_id ?? null);
  return { userId, vendorId };
}

export const vendorKeys = {
  rfqs: (userId: string | null) => [...queryKeys.scope(userId), 'rfqs'] as const,
  rfq: (userId: string | null, id: string) => [...vendorKeys.rfqs(userId), id] as const,
  quotations: (userId: string | null, rfqId: string) => [...vendorKeys.rfq(userId, rfqId), 'quotations'] as const,
  alternatives: (userId: string | null, rfqId: string) => [...vendorKeys.rfq(userId, rfqId), 'alternatives'] as const,
  conversations: (userId: string | null) => [...queryKeys.scope(userId), 'conversations'] as const,
  messages: (userId: string | null, conversationId: string) => [...vendorKeys.conversations(userId), conversationId, 'messages'] as const,
  workOrders: (userId: string | null) => [...queryKeys.scope(userId), 'work-orders'] as const,
  workOrder: (userId: string | null, id: string) => [...vendorKeys.workOrders(userId), id] as const,
};

/** This vendor's own row on an RFQ. The UI never renders any other vendor. */
export function ownEntry(rfq: Rfq, vendorId: string | null): RfqVendor | null {
  return rfq.vendors.find((entry) => entry.vendor_id === vendorId) ?? null;
}

export function useRfqs() {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(RFQ_POLL_MS);
  return useQuery({ queryKey: vendorKeys.rfqs(userId), queryFn: api.listRfqs, enabled: userId !== null, refetchInterval });
}

export function useRfq(id: string) {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(RFQ_POLL_MS);
  return useQuery({
    queryKey: vendorKeys.rfq(userId, id),
    queryFn: () => api.getRfq(id),
    enabled: userId !== null && id !== '',
    refetchInterval,
  });
}

export function useQuotations(rfqId: string) {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(RFQ_POLL_MS);
  return useQuery({
    queryKey: vendorKeys.quotations(userId, rfqId),
    queryFn: () => api.listQuotations(rfqId),
    enabled: userId !== null,
    refetchInterval,
  });
}

export type MyQuote = { rfq: Rfq; latest: Quotation };

/** Latest quotation round per RFQ, across all of this vendor's RFQs. RFQs not yet quoted are left out. */
export function useMyQuotes(): { quotes: MyQuote[]; isPending: boolean; error: unknown; refetch: () => void; isFetching: boolean } {
  const { userId } = useScope();
  const rfqs = useRfqs();
  const rfqList = rfqs.data;
  const refetchInterval = usePollInterval(RFQ_POLL_MS);
  const results = useQueries({
    queries: (rfqList ?? []).map((rfq) => ({
      queryKey: vendorKeys.quotations(userId, rfq.id),
      queryFn: () => api.listQuotations(rfq.id),
      enabled: userId !== null,
      refetchInterval,
    })),
  });
  const quotes = useMemo<MyQuote[]>(() => {
    const rows: MyQuote[] = [];
    (rfqList ?? []).forEach((rfq, index) => {
      const rounds = results[index]?.data ?? [];
      const latest = rounds.reduce<Quotation | null>((best, round) => (best === null || round.round > best.round ? round : best), null);
      if (latest) rows.push({ rfq, latest });
    });
    return rows;
  }, [rfqList, results]);
  const failed = results.find((result) => result.isError);
  return {
    quotes,
    isPending: rfqs.isPending || results.some((result) => result.isPending),
    error: rfqs.error ?? failed?.error ?? null,
    refetch: () => {
      void rfqs.refetch();
      results.forEach((result) => void result.refetch());
    },
    isFetching: rfqs.isFetching || results.some((result) => result.isFetching),
  };
}

export function useConversations() {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(CONVERSATION_POLL_MS);
  return useQuery({ queryKey: vendorKeys.conversations(userId), queryFn: api.listConversations, enabled: userId !== null, refetchInterval });
}

export function useConversationForRfq(rfqId: string): Conversation | null {
  const { data } = useConversations();
  return useMemo(() => (data ?? []).find((conversation) => conversation.rfq_id === rfqId) ?? null, [data, rfqId]);
}

export function useUnreadMessages(): number {
  const { data } = useConversations();
  return (data ?? []).reduce((total, conversation) => total + conversation.unread, 0);
}

export function useMessages(conversationId: string) {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(MESSAGE_POLL_MS);
  return useQuery({
    queryKey: vendorKeys.messages(userId, conversationId),
    queryFn: () => api.listMessages(conversationId),
    enabled: userId !== null,
    refetchInterval,
    staleTime: 0,
  });
}

export function useWorkOrders() {
  const { userId } = useScope();
  const refetchInterval = usePollInterval(RFQ_POLL_MS);
  return useQuery({ queryKey: vendorKeys.workOrders(userId), queryFn: api.listWorkOrders, enabled: userId !== null, refetchInterval });
}

export function useWorkOrder(id: string) {
  const { userId } = useScope();
  return useQuery({ queryKey: vendorKeys.workOrder(userId, id), queryFn: () => api.getWorkOrder(id), enabled: userId !== null });
}

// The contract has no read endpoint for alternatives. The vendor sees what it proposed this session;
// the HOD's decision arrives as a notification and a chat message.
export function useSentAlternatives(rfqId: string): Alternative[] {
  const { userId } = useScope();
  const { data } = useQuery<Alternative[]>({
    queryKey: vendorKeys.alternatives(userId, rfqId),
    queryFn: skipToken,
    initialData: [],
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? NO_ALTERNATIVES;
}

function useVendorInvalidation() {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  return {
    rfqs: () => void queryClient.invalidateQueries({ queryKey: vendorKeys.rfqs(userId) }),
    conversations: () => void queryClient.invalidateQueries({ queryKey: vendorKeys.conversations(userId) }),
  };
}

export function useSendMessage(conversationId: string) {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  const invalidate = useVendorInvalidation();
  return useMutation({
    mutationFn: (input: { text: string; rfqItemId: string | null } | { audio: UploadFile; rfqItemId: string | null }) =>
      'audio' in input
        ? api.sendVoiceMessage(conversationId, input.audio, input.rfqItemId)
        : api.sendTextMessage(conversationId, input.text, input.rfqItemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vendorKeys.messages(userId, conversationId) });
      invalidate.conversations();
      invalidate.rfqs();
    },
  });
}

export function useProposeAlternative(rfqId: string) {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  const invalidate = useVendorInvalidation();
  return useMutation({
    mutationFn: (input: AlternativeInput) => api.proposeAlternative(input),
    onSuccess: (alternative) => {
      queryClient.setQueryData<Alternative[]>(vendorKeys.alternatives(userId, rfqId), (previous) => [...(previous ?? []), alternative]);
      invalidate.rfqs();
      invalidate.conversations();
    },
  });
}

export function useReplyAlternative(rfqId: string) {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  const invalidate = useVendorInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AlternativeReplyInput }) => api.replyAlternative(id, input),
    onSuccess: (alternative) => {
      queryClient.setQueryData<Alternative[]>(vendorKeys.alternatives(userId, rfqId), (previous) =>
        (previous ?? []).map((candidate) => (candidate.id === alternative.id ? alternative : candidate)),
      );
      invalidate.rfqs();
      invalidate.conversations();
    },
  });
}

export function useAcknowledgeWorkOrder(id: string) {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.acknowledgeWorkOrder(id),
    onSuccess: (order: WorkOrder) => {
      queryClient.setQueryData(vendorKeys.workOrder(userId, id), order);
      void queryClient.invalidateQueries({ queryKey: vendorKeys.workOrders(userId) });
    },
  });
}

export function useSubmitQuotation(rfqId: string) {
  const { userId } = useScope();
  const queryClient = useQueryClient();
  const invalidate = useVendorInvalidation();
  return useMutation({
    mutationFn: (input: QuotationInput) => api.submitQuotation(rfqId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vendorKeys.quotations(userId, rfqId) });
      invalidate.rfqs();
      invalidate.conversations();
    },
  });
}
