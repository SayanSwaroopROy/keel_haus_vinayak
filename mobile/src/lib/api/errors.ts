import { ApiErrorBodySchema } from './schemas';

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_transition'
  | 'conflict'
  | 'unsupported_file'
  | 'file_too_large'
  | 'vendor_not_registered'
  | 'provider_error'
  | 'timeout'
  | 'internal'
  | 'network_error'
  | 'bad_response'
  | 'not_configured';

const SERVER_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid_transition',
  'conflict',
  'unsupported_file',
  'file_too_large',
  'vendor_not_registered',
  'provider_error',
  'timeout',
  'internal',
]);

function isServerCode(code: string): code is ApiErrorCode {
  return SERVER_CODES.has(code);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
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
      ? new ApiError(status, 'internal', 'The server is unavailable right now. Try again shortly.')
      : new ApiError(status, 'bad_response', 'The server sent an unexpected response.');
  }
  const { code, message, details } = parsed.data.error;
  return new ApiError(status, isServerCode(code) ? code : 'internal', message, details);
}

export function fromThrown(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ApiError(504, 'timeout', 'The server took too long to answer.');
  }
  return new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
}

const FRIENDLY: Partial<Record<ApiErrorCode, string>> = {
  unauthorized: 'Pick who you are working as to continue.',
  forbidden: "You don't have access to this.",
  not_found: 'This record no longer exists.',
  invalid_transition: 'This requisition has already moved on. Pull down to refresh.',
  conflict: 'Something changed meanwhile. Refresh and try again.',
  unsupported_file: 'This file type is not supported. Use a photo, voice note, PDF, CSV, XLSX, DOCX or TXT.',
  file_too_large: 'This file is over 20 MB. Send a smaller file or a photo instead.',
  timeout: 'The server took too long to answer. Try again.',
  network_error: 'Could not reach the server. Check your signal and try again.',
  provider_error: 'The voice or AI service failed. Try again shortly.',
  not_configured: 'The app has no server address. Set EXPO_PUBLIC_API_BASE_URL and restart Expo.',
};

export function describeError(error: unknown): string {
  const apiError = fromThrown(error);
  return FRIENDLY[apiError.code] ?? apiError.message;
}
