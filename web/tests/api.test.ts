// Contract test against the running FastAPI backend (api/). Start it first: `uv run uvicorn app.main:app`.
import request from "supertest";
import { describe, expect, it } from "vitest";
import { EchoOutSchema, HealthSchema } from "../src/lib/schemas";

const API = process.env.API_URL ?? "http://127.0.0.1:8000";

describe("api contract", () => {
  it("GET /health -> 200", async () => {
    const res = await request(API).get("/health").expect(200);
    expect(HealthSchema.parse(res.body)).toEqual({ status: "ok" });
  });

  it("POST /echo invalid -> 422", async () => {
    await request(API).post("/echo").send({ message: "" }).expect(422);
  });

  it("POST /echo valid -> schema match", async () => {
    const res = await request(API).post("/echo").send({ message: "hi" }).expect(200);
    expect(EchoOutSchema.parse(res.body)).toEqual({ echo: "hi", length: 2 });
  });
});
