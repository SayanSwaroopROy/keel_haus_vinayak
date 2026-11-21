import type { z } from "zod";
import { getUserId, useSession } from "@/lib/auth/session";
import { ApiError, fromThrown, parseErrorBody } from "./errors";

const BASE = "/api";
const TIMEOUT_MS = 15_000;

type Method = "GET" | "POST" | "PATCH";

type RequestOptions<T> = {
  method?: Method;
  body?: unknown;
  schema: z.ZodType<T>;
  /** False only for /health and GET /users, which need no identity. */
  identified?: boolean;
};

function identityHeader(): Record<string, string> {
  const userId = getUserId();
  if (!userId) throw new ApiError(401, "unauthorized", "No identity selected.");
  return { "X-User-Id": userId };
}

export async function apiFetch<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { method = "GET", body, schema, identified = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (identified) Object.assign(headers, identityHeader());

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw fromThrown(error);
  }

  if (response.status === 204) return schema.parse(undefined);

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = parseErrorBody(response.status, payload);
    if (error.code === "unauthorized" && identified) useSession.getState().clearUser();
    throw error;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, "bad_response", "The server response did not match the contract.", parsed.error.issues);
  }
  return parsed.data;
}

export async function apiFetchBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: identityHeader(),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
  } catch (error) {
    throw fromThrown(error);
  }
  if (!response.ok) throw parseErrorBody(response.status, await response.json().catch(() => null));
  return response.blob();
}
