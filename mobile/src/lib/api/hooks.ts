import { useEffect } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useIdentity } from '@/lib/identity';
import { usePollInterval } from '@/lib/use-poll';

import { api, type UploadFile } from './endpoints';
import { isApiError } from './errors';
import type { InputType, ReqItem, Requisition, Role } from './schemas';

const NOTIFICATION_POLL_MS = 5_000;
const INGEST_POLL_MS = 1_500;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

// Keys are scoped by user so switching identity never shows another user's cache.
export const queryKeys = {
  users: (role: Role | 'all') => ['users', role] as const,
  scope: (userId: string | null) => ['as', userId ?? 'nobody'] as const,
  projects: (userId: string | null) => [...queryKeys.scope(userId), 'projects'] as const,
  notifications: (userId: string | null) => [...queryKeys.scope(userId), 'notifications'] as const,
  requisitions: (userId: string | null) => [...queryKeys.scope(userId), 'requisitions'] as const,
  requisition: (userId: string | null, id: string) => [...queryKeys.requisitions(userId), id] as const,
  revisions: (userId: string | null, id: string) => [...queryKeys.requisition(userId, id), 'revisions'] as const,
  ingestJob: (userId: string | null, jobId: string) => [...queryKeys.scope(userId), 'ingest', jobId] as const,
};

function useUserId(): string | null {
  return useIdentity((state) => state.user?.id ?? null);
}

export function useUsers(role?: Role) {
  return useQuery({
    queryKey: queryKeys.users(role ?? 'all'),
    queryFn: () => api.listUsers(role),
    staleTime: 60_000,
  });
}

export function useProjects() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.projects(userId),
    queryFn: api.listProjects,
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });
}

export function useNotifications() {
  const userId = useUserId();
  const refetchInterval = usePollInterval(NOTIFICATION_POLL_MS);
  return useQuery({
    queryKey: queryKeys.notifications(userId),
    queryFn: api.listNotifications,
    enabled: userId !== null,
    refetchInterval,
  });
}

export function useMarkNotificationRead() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markNotificationRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) }),
  });
}

export function useRequisitions() {
  const userId = useUserId();
  const refetchInterval = usePollInterval(10_000);
  return useQuery({
    queryKey: queryKeys.requisitions(userId),
    queryFn: api.listRequisitions,
    enabled: userId !== null,
    refetchInterval,
  });
}

export function useRequisition(id: string) {
  const userId = useUserId();
  const refetchInterval = usePollInterval(5_000);
  return useQuery({
    queryKey: queryKeys.requisition(userId, id),
    queryFn: () => api.getRequisition(id),
    enabled: userId !== null,
    refetchInterval,
  });
}

export function useRevisions(id: string) {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.revisions(userId, id),
    queryFn: () => api.listRevisions(id),
    enabled: userId !== null,
  });
}

export function useIngestJob(jobId: string | null) {
  const userId = useUserId();
  const pollInterval = usePollInterval(INGEST_POLL_MS);
  return useQuery({
    queryKey: queryKeys.ingestJob(userId, jobId ?? 'none'),
    queryFn: () => api.getIngestJob(jobId ?? ''),
    enabled: userId !== null && jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'DONE' || status === 'FAILED' ? false : pollInterval;
    },
    staleTime: 0,
  });
}

export function useUnreadCount(): number {
  const { data } = useNotifications();
  return (data ?? []).filter((notification) => notification.read_at === null).length;
}

export function useStartIngest() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; inputType: InputType; file: UploadFile } | { projectId: string; text: string }) =>
      'text' in input ? api.createTextRequisition(input.projectId, input.text) : api.ingestFile(input.projectId, input.inputType, input.file),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.ingestJob(userId, job.id), job);
    },
  });
}

export function useRefreshRequisitionsWhenDone(job: { status: string } | undefined) {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const done = job?.status === 'DONE';
  useEffect(() => {
    if (done) void queryClient.invalidateQueries({ queryKey: queryKeys.requisitions(userId), exact: true });
  }, [done, queryClient, userId]);
}

function useRequisitionWriter() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return (requisition: Requisition) => {
    queryClient.setQueryData(queryKeys.requisition(userId, requisition.id), requisition);
    void queryClient.invalidateQueries({ queryKey: queryKeys.requisitions(userId), exact: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.revisions(userId, requisition.id) });
  };
}

export function useCorrectRequisition(id: string) {
  const write = useRequisitionWriter();
  return useMutation({ mutationFn: (text: string) => api.correctByText(id, text), onSuccess: write });
}

export function useCorrectByVoice(id: string) {
  const write = useRequisitionWriter();
  return useMutation({ mutationFn: (file: UploadFile) => api.correctByVoice(id, file), onSuccess: write });
}

export function useEditItem(id: string) {
  const write = useRequisitionWriter();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: Partial<ReqItem> }) => api.editItem(id, itemId, patch),
    onSuccess: write,
  });
}

export function useConfirmRequisition(id: string) {
  const write = useRequisitionWriter();
  return useMutation({ mutationFn: () => api.confirm(id), onSuccess: write });
}

export function useReadback(id: string) {
  return useMutation({ mutationFn: () => api.readback(id) });
}
