import { describe, expect, it } from "vitest";
import { useCounter } from "./store";
import { EchoInSchema } from "./schemas";

describe("smoke", () => {
  it("zod validates and rejects", () => {
    expect(EchoInSchema.safeParse({ message: "hi" }).success).toBe(true);
    expect(EchoInSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("zustand store updates", () => {
    useCounter.getState().inc();
    expect(useCounter.getState().count).toBe(1);
  });
});
