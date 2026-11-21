import type { z } from "zod";
import { getToken, useSession } from "@/lib/auth/session";
import { ApiError, fromThrown, parseErrorBody } from "./errors";

const BASE = "/api";
const TIMEOUT_MS = 15_000;

type Method = "GET" | "POST" | "PATCH";

type RequestOptions<T> = {
  method?: Method;
  body?: unknown;
  schema: z.ZodType<T>;
  auth?: boolean;
};

export async function apiFetch<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { method = "GET", body, schema, auth = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, "unauthorized", "Not signed in.");
    headers.Authorization = `Bearer ${token}`;
  }

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
    if (error.code === "unauthorized" && auth) useSession.getState().signOut();
    throw error;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, "bad_response", "The server response did not match the contract.", parsed.error.issues);
  }
  return parsed.data;
}

export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  if (!token) throw new ApiError(401, "unauthorized", "Not signed in.");
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
  } catch (error) {
    throw fromThrown(error);
  }
  if (!response.ok) throw parseErrorBody(response.status, await response.json().catch(() => null));
  return response.blob();
}
