import type { z } from 'zod';

import { API_BASE_URL } from '@/lib/config';
import { getUserId, useIdentity } from '@/lib/identity';

import { ApiError, fromThrown, parseErrorBody } from './errors';

const TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000;

type Method = 'GET' | 'POST' | 'PATCH';

type RequestOptions<T> = {
  method?: Method;
  body?: unknown;
  formData?: FormData;
  schema: z.ZodType<T>;
  /** False only for /health and GET /users, which need no identity. */
  identified?: boolean;
};

function baseUrl(): string {
  if (!API_BASE_URL) throw new ApiError(0, 'not_configured', 'EXPO_PUBLIC_API_BASE_URL is not set.');
  return API_BASE_URL;
}

function identityHeader(): Record<string, string> {
  const userId = getUserId();
  if (!userId) throw new ApiError(401, 'unauthorized', 'No identity selected.');
  return { 'X-User-Id': userId };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { method = 'GET', body, formData, schema, identified = true } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (identified) Object.assign(headers, identityHeader());

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${baseUrl()}${path}`,
      {
        method,
        headers,
        body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
      },
      formData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS,
    );
  } catch (error) {
    throw fromThrown(error);
  }

  if (response.status === 204) return schema.parse(undefined);

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = parseErrorBody(response.status, payload);
    if (error.code === 'unauthorized' && identified) useIdentity.getState().clearUser();
    throw error;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, 'bad_response', 'The server response did not match the contract.', parsed.error.issues);
  }
  return parsed.data;
}
