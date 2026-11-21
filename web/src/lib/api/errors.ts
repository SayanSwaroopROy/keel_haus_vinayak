import { ApiErrorBodySchema } from "./schemas";

export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_transition"
  | "conflict"
  | "unsupported_file"
  | "file_too_large"
  | "vendor_not_registered"
  | "provider_error"
  | "timeout"
  | "internal"
  | "network_error"
  | "bad_response";

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "invalid_transition",
  "conflict",
  "unsupported_file",
  "file_too_large",
  "vendor_not_registered",
  "provider_error",
  "timeout",
  "internal",
  "network_error",
  "bad_response",
]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function parseErrorBody(status: number, body: unknown): ApiError {
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return status >= 500
      ? new ApiError(status, "internal", "The server is unavailable right now. Try again shortly.")
      : new ApiError(status, "bad_response", "The server sent an unexpected response.");
  }
  const { code, message, details } = parsed.data.error;
  const knownCode: ApiErrorCode = KNOWN_CODES.has(code) ? (code as ApiErrorCode) : "internal";
  return new ApiError(status, knownCode, message, details);
}

export function fromThrown(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new ApiError(504, "timeout", "The server took too long to answer.");
  }
  return new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
}

const FRIENDLY: Partial<Record<ApiErrorCode, string>> = {
  unauthorized: "Pick who you are working as to continue.",
  forbidden: "You don't have access to this.",
  not_found: "This record no longer exists.",
  invalid_transition: "This record has already moved on. Refresh to see its current state.",
  conflict: "Something changed meanwhile. Refresh and try again.",
  vendor_not_registered: "This vendor has not completed the registration checklist yet.",
  timeout: "The server took too long to answer. Try again.",
  network_error: "Could not reach the server. Check your connection and try again.",
  provider_error: "An AI or voice service failed. Try again shortly.",
};

export function describeError(error: unknown): string {
  const apiError = fromThrown(error);
  return FRIENDLY[apiError.code] ?? apiError.message;
}
