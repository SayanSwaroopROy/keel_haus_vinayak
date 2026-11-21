// Live contract test against the running FastAPI backend. Start it first: `pnpm dev:api`.
// Seeded identities come from GET /users; every other call sends X-User-Id.
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DashboardStatsSchema,
  InventoryRowSchema,
  NotificationSchema,
  ProjectSchema,
  RequisitionSchema,
  UserSchema,
  VendorSchema,
} from "../src/lib/api/schemas";
import { ConversationSchema, RfqSchema, WorkOrderSchema } from "../src/lib/api/schemas-flow";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";

const get = async (path: string, userId?: string) => {
  const response = await fetch(`${API}${path}`, { headers: userId ? { "X-User-Id": userId } : {} });
  return { status: response.status, body: (await response.json()) as unknown };
};

describe("api contract (live)", { timeout: 30_000 }, () => {
  let hodId = "";

  beforeAll(async () => {
    const users = await get("/users?role=hod");
    hodId = z.array(UserSchema).parse(users.body)[0]?.id ?? "";
    expect(hodId).not.toBe("");
  });

  it("GET /health", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects a missing X-User-Id with 401", async () => {
    expect((await get("/projects")).status).toBe(401);
  });

  it("rejects an unknown X-User-Id with 401", async () => {
    expect((await get("/projects", "00000000-0000-0000-0000-000000000000")).status).toBe(401);
  });

  it.each([
    ["/me", UserSchema],
    ["/projects", z.array(ProjectSchema)],
    ["/notifications", z.array(NotificationSchema)],
    ["/dashboard/stats", DashboardStatsSchema],
    ["/requisitions", z.array(RequisitionSchema)],
    ["/inventory", z.array(InventoryRowSchema)],
    ["/vendors", z.array(VendorSchema)],
    ["/rfqs", z.array(RfqSchema)],
    ["/work-orders", z.array(WorkOrderSchema)],
    ["/conversations", z.array(ConversationSchema)],
  ])("GET %s matches the zod schema", async (path, schema) => {
    const res = await get(path, hodId);
    expect(res.status).toBe(200);
    const parsed = schema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });
});
