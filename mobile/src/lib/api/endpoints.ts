import { z } from 'zod';

import { apiFetch } from './client';
import { mockHandlers } from './mocks/handlers';
import { isMocked } from './mode';
import {
  IngestJobSchema,
  NotificationSchema,
  ProjectSchema,
  ReadbackSchema,
  RequisitionSchema,
  RevisionSchema,
  UserSchema,
  type AppNotification,
  type IngestJob,
  type InputType,
  type Project,
  type Readback,
  type ReqItem,
  type Requisition,
  type Revision,
  type Role,
  type User,
} from './schemas';

export type UploadFile = { uri: string; name: string; mimeType: string };

// React Native's FormData accepts {uri, name, type} for files; the DOM typings do not know it.
function appendFile(form: FormData, field: string, file: UploadFile): void {
  const part = { uri: file.uri, name: file.name, type: file.mimeType };
  form.append(field, part as unknown as Blob);
}

const VoidSchema = z.undefined();

export const api = {
  listUsers(role?: Role): Promise<User[]> {
    if (isMocked('users.list')) return mockHandlers.listUsers(role);
    const query = role ? `?role=${encodeURIComponent(role)}` : '';
    return apiFetch(`/users${query}`, { schema: z.array(UserSchema), identified: false });
  },

  me(): Promise<User> {
    if (isMocked('me')) return mockHandlers.me();
    return apiFetch('/me', { schema: UserSchema });
  },

  listProjects(): Promise<Project[]> {
    if (isMocked('projects.list')) return mockHandlers.listProjects();
    return apiFetch('/projects', { schema: z.array(ProjectSchema) });
  },

  listNotifications(): Promise<AppNotification[]> {
    if (isMocked('notifications')) return mockHandlers.listNotifications();
    return apiFetch('/notifications', { schema: z.array(NotificationSchema) });
  },

  markNotificationRead(id: string): Promise<void> {
    if (isMocked('notifications')) return mockHandlers.markNotificationRead(id);
    return apiFetch(`/notifications/${id}/read`, { method: 'POST', schema: VoidSchema });
  },

  ingestFile(projectId: string, inputType: InputType, file: UploadFile): Promise<IngestJob> {
    if (isMocked('ingest')) return mockHandlers.ingestFile(projectId, inputType);
    const form = new FormData();
    appendFile(form, 'file', file);
    form.append('project_id', projectId);
    form.append('input_type', inputType);
    return apiFetch('/ingest', { method: 'POST', formData: form, schema: IngestJobSchema });
  },

  createTextRequisition(projectId: string, text: string): Promise<IngestJob> {
    if (isMocked('requisitions.create')) return mockHandlers.createTextRequisition(projectId, text);
    return apiFetch('/requisitions', { method: 'POST', body: { project_id: projectId, text }, schema: IngestJobSchema });
  },

  getIngestJob(jobId: string): Promise<IngestJob> {
    if (isMocked('ingest')) return mockHandlers.getIngestJob(jobId);
    return apiFetch(`/ingest/${jobId}`, { schema: IngestJobSchema });
  },

  listRequisitions(): Promise<Requisition[]> {
    if (isMocked('requisitions.list')) return mockHandlers.listRequisitions();
    return apiFetch('/requisitions', { schema: z.array(RequisitionSchema) });
  },

  getRequisition(id: string): Promise<Requisition> {
    if (isMocked('requisitions.get')) return mockHandlers.getRequisition(id);
    return apiFetch(`/requisitions/${id}`, { schema: RequisitionSchema });
  },

  listRevisions(id: string): Promise<Revision[]> {
    if (isMocked('requisitions.revisions')) return mockHandlers.listRevisions(id);
    return apiFetch(`/requisitions/${id}/revisions`, { schema: z.array(RevisionSchema) });
  },

  readback(id: string): Promise<Readback> {
    if (isMocked('requisitions.readback')) return mockHandlers.readback(id);
    return apiFetch(`/requisitions/${id}/readback`, { method: 'POST', body: {}, schema: ReadbackSchema });
  },

  correctByText(id: string, text: string): Promise<Requisition> {
    if (isMocked('requisitions.correct')) return mockHandlers.correct(id, text);
    return apiFetch(`/requisitions/${id}/correct`, { method: 'POST', body: { text }, schema: RequisitionSchema });
  },

  editItem(id: string, itemId: string, patch: Partial<ReqItem>): Promise<Requisition> {
    if (isMocked('requisitions.editItem')) return mockHandlers.editItem(id, itemId, patch);
    return apiFetch(`/requisitions/${id}/items/${itemId}`, { method: 'PATCH', body: patch, schema: RequisitionSchema });
  },

  confirm(id: string): Promise<Requisition> {
    if (isMocked('requisitions.confirm')) return mockHandlers.confirm(id);
    return apiFetch(`/requisitions/${id}/confirm`, { method: 'POST', body: {}, schema: RequisitionSchema });
  },
};
