export type {
  InventoryRow,
  Project,
  ReqItem,
  Requisition,
  Revision,
  Vendor,
} from "../schemas";

import type { MatchCodesResponse } from "../schemas";

export type CodeMatch = MatchCodesResponse["items"][number]["matches"][number];
