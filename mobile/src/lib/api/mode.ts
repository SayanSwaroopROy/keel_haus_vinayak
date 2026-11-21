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
  | 'requisitions.confirm';

const MOCKED: ReadonlySet<EndpointKey> = new Set<EndpointKey>([
  // GET /users and X-User-Id are pending the backend's no-login rework.
  'users.list',
  'me',
  'projects.list',
  'notifications',
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
]);

export function isMocked(key: EndpointKey): boolean {
  return MOCKED.has(key);
}

export const ANY_MOCKED = MOCKED.size > 0;
