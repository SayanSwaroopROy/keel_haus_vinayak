// Endpoints the backend has not built yet are served from in-memory mocks.
// INTEGRATOR: delete a key here once its real endpoint passes the contract tests.
export type EndpointKey =
  | 'users.list'
  | 'me'
  | 'projects.list'
  | 'notifications'
  | 'ingest'
  | 'requisitions.create'
  | 'requisitions.list'
  | 'requisitions.get'
  | 'requisitions.revisions'
  | 'requisitions.readback'
  | 'requisitions.correct'
  | 'requisitions.editItem'
  | 'requisitions.confirm'
  | 'rfqs.list'
  | 'rfqs.get'
  | 'conversations.list'
  | 'messages.list'
  | 'messages.send'
  | 'alternatives.create'
  | 'quotations.list'
  | 'quotations.submit'
  | 'workOrders.list'
  | 'workOrders.get'
  | 'workOrders.acknowledge'
  | 'alternatives.reply';

const MOCKED: ReadonlySet<EndpointKey> = new Set<EndpointKey>([
  // Phase 2 ingestion and confirmation are not built yet.
  'ingest',
  'requisitions.create',
  'requisitions.list',
  'requisitions.get',
  'requisitions.revisions',
  'requisitions.readback',
  'requisitions.correct',
  'requisitions.editItem',
  'requisitions.confirm',
  // Phase 5 and 6 vendor endpoints are not built yet.
  'rfqs.list',
  'rfqs.get',
  'conversations.list',
  'messages.list',
  'messages.send',
  'alternatives.create',
  'quotations.list',
  'quotations.submit',
  'workOrders.list',
  'workOrders.get',
  'workOrders.acknowledge',
  'alternatives.reply',
]);

export function isMocked(key: EndpointKey): boolean {
  return MOCKED.has(key);
}

export const ANY_MOCKED = MOCKED.size > 0;
