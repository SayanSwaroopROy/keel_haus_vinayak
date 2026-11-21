import { z } from "zod";

// Mirrors api/app/main.py response models.
export const HealthSchema = z.object({ status: z.literal("ok") });

export const EchoInSchema = z.object({ message: z.string().min(1) });
export const EchoOutSchema = z.object({ echo: z.string(), length: z.number().int() });
