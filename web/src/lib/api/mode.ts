// Endpoints the backend has not built yet are served from in-memory mocks.
// INTEGRATOR: delete a key here once its real endpoint passes the contract tests.
export type EndpointKey =
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
  | "vendors.performance"
  | "files.get";

export const MOCKED: ReadonlySet<EndpointKey> = new Set<EndpointKey>([
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
  "vendors.performance",
  "files.get",
]);

export function isMocked(key: EndpointKey): boolean {
  return MOCKED.has(key);
}

export const ANY_MOCKED = MOCKED.size > 0;
