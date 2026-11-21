// Endpoints the backend has not built yet are served from in-memory mocks.
// INTEGRATOR: delete a key here once its real endpoint passes the contract tests.
export type EndpointKey =
  | "users.list"
  | "projects.list"
  | "notifications"
  | "dashboard.stats"
  | "requisitions.list"
  | "requisitions.get"
  | "requisitions.revisions"
  | "requisitions.matchCodes"
  | "requisitions.assignCode"
  | "requisitions.stockCheck"
  | "requisitions.decision"
  | "inventory.list"
  | "vendors.list"
  | "vendors.create"
  | "vendors.update"
  | "vendors.registration"
  | "vendors.performance"
  | "rfqs"
  | "alternatives"
  | "conversations"
  | "quotations"
  | "evaluation"
  | "workOrders"
  | "files.get";

export const MOCKED: ReadonlySet<EndpointKey> = new Set<EndpointKey>([
  // Backend still has JWT login; GET /users and X-User-Id are pending its rework.
  "users.list",
  "projects.list",
  "notifications",
  "dashboard.stats",
  "requisitions.list",
  "requisitions.get",
  "requisitions.revisions",
  "requisitions.matchCodes",
  "requisitions.assignCode",
  "requisitions.stockCheck",
  "requisitions.decision",
  "inventory.list",
  "vendors.list",
  "vendors.create",
  "vendors.update",
  "vendors.registration",
  "vendors.performance",
  "rfqs",
  "alternatives",
  "conversations",
  "quotations",
  "evaluation",
  "workOrders",
  "files.get",
]);

export function isMocked(key: EndpointKey): boolean {
  return MOCKED.has(key);
}

export const ANY_MOCKED = MOCKED.size > 0;
