import { File } from 'expo-file-system';
import { z } from 'zod';

import { apiFetch } from './client';
import { mockHandlers } from './mocks/handlers';
import { vendorMocks } from './mocks/vendor';
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
import {
  AlternativeSchema,
  ConversationSchema,
  MessageSchema,
  QuotationSchema,
  RfqSchema,
  WorkOrderSchema,
  type Alternative,
  type AlternativeInput,
  type AlternativeReplyInput,
  type Conversation,
  type Message,
  type Quotation,
  type QuotationInput,
  type Rfq,
  type WorkOrder,
} from './schemas-vendor';

export type UploadFile = { uri: string; name: string; mimeType: string };

// Expo's fetch rejects React Native's {uri, name, type} parts. It accepts any part with name, type and bytes().
function appendFile(form: FormData, field: string, file: UploadFile): void {
  const source = new File(file.uri);
  const part = { name: file.name, type: file.mimeType, bytes: () => source.bytes() };
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

  correctByVoice(id: string, file: UploadFile): Promise<Requisition> {
    if (isMocked('requisitions.correct')) return mockHandlers.correctByVoice(id);
    const form = new FormData();
    appendFile(form, 'audio', file);
    return apiFetch(`/requisitions/${id}/correct`, { method: 'POST', formData: form, schema: RequisitionSchema });
  },

  editItem(id: string, itemId: string, patch: Partial<ReqItem>): Promise<Requisition> {
    if (isMocked('requisitions.editItem')) return mockHandlers.editItem(id, itemId, patch);
    return apiFetch(`/requisitions/${id}/items/${itemId}`, { method: 'PATCH', body: patch, schema: RequisitionSchema });
  },

  confirm(id: string): Promise<Requisition> {
    if (isMocked('requisitions.confirm')) return mockHandlers.confirm(id);
    return apiFetch(`/requisitions/${id}/confirm`, { method: 'POST', body: {}, schema: RequisitionSchema });
  },

  // Vendor app. The server returns only the signed-in vendor's own rows.
  listRfqs(): Promise<Rfq[]> {
    if (isMocked('rfqs.list')) return vendorMocks.listRfqs();
    return apiFetch('/rfqs', { schema: z.array(RfqSchema) });
  },

  getRfq(id: string): Promise<Rfq> {
    if (isMocked('rfqs.get')) return vendorMocks.getRfq(id);
    return apiFetch(`/rfqs/${id}`, { schema: RfqSchema });
  },

  listConversations(): Promise<Conversation[]> {
    if (isMocked('conversations.list')) return vendorMocks.listConversations();
    return apiFetch('/conversations', { schema: z.array(ConversationSchema) });
  },

  listMessages(conversationId: string): Promise<Message[]> {
    if (isMocked('messages.list')) return vendorMocks.listMessages(conversationId);
    return apiFetch(`/conversations/${conversationId}/messages`, { schema: z.array(MessageSchema) });
  },

  sendTextMessage(conversationId: string, text: string, rfqItemId: string | null): Promise<Message> {
    if (isMocked('messages.send')) return vendorMocks.sendMessage(conversationId, { text, rfqItemId, audio: null });
    const body = rfqItemId === null ? { text } : { text, rfq_item_id: rfqItemId };
    return apiFetch(`/conversations/${conversationId}/messages`, { method: 'POST', body, schema: MessageSchema });
  },

  sendVoiceMessage(conversationId: string, audio: UploadFile, rfqItemId: string | null): Promise<Message> {
    if (isMocked('messages.send')) return vendorMocks.sendMessage(conversationId, { text: null, rfqItemId, audio });
    const form = new FormData();
    appendFile(form, 'audio', audio);
    if (rfqItemId !== null) form.append('rfq_item_id', rfqItemId);
    return apiFetch(`/conversations/${conversationId}/messages`, { method: 'POST', formData: form, schema: MessageSchema });
  },

  proposeAlternative(input: AlternativeInput): Promise<Alternative> {
    if (isMocked('alternatives.create')) return vendorMocks.proposeAlternative(input);
    return apiFetch('/alternatives', { method: 'POST', body: input, schema: AlternativeSchema });
  },

  replyAlternative(id: string, input: AlternativeReplyInput): Promise<Alternative> {
    if (isMocked('alternatives.reply')) return vendorMocks.replyAlternative(id, input);
    return apiFetch(`/alternatives/${id}/reply`, { method: 'POST', body: input, schema: AlternativeSchema });
  },

  listQuotations(rfqId: string): Promise<Quotation[]> {
    if (isMocked('quotations.list')) return vendorMocks.listQuotations(rfqId);
    return apiFetch(`/rfqs/${rfqId}/quotations`, { schema: z.array(QuotationSchema) });
  },

  submitQuotation(rfqId: string, input: QuotationInput): Promise<Quotation> {
    if (isMocked('quotations.submit')) return vendorMocks.submitQuotation(rfqId, input);
    return apiFetch(`/rfqs/${rfqId}/quotations`, { method: 'POST', body: input, schema: QuotationSchema });
  },

  listWorkOrders(): Promise<WorkOrder[]> {
    if (isMocked('workOrders.list')) return vendorMocks.listWorkOrders();
    return apiFetch('/work-orders', { schema: z.array(WorkOrderSchema) });
  },

  acknowledgeWorkOrder(id: string): Promise<WorkOrder> {
    if (isMocked('workOrders.acknowledge')) return vendorMocks.acknowledgeWorkOrder(id);
    return apiFetch(`/work-orders/${id}/acknowledge`, { method: 'POST', body: {}, schema: WorkOrderSchema });
  },

  getWorkOrder(id: string): Promise<WorkOrder> {
    if (isMocked('workOrders.get')) return vendorMocks.getWorkOrder(id);
    return apiFetch(`/work-orders/${id}`, { schema: WorkOrderSchema });
  },
};
