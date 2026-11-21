// The only env var the app reads. It is public: never put a secret in EXPO_PUBLIC_*.
// Must be accessed statically so Metro inlines it.
const rawBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL: string | null =
  rawBaseUrl && rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim().replace(/\/+$/, '') : null;

/**
 * The API returns file paths like `/files/<id>` relative to its own root. Join them to the full base URL
 * (which already ends in `/api` behind the Next proxy). Absolute URLs pass through.
 * Note: `GET /files/{id}` needs the X-User-Id header, which an audio player cannot send; see known issues.
 */
export function resolveFileUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (!url.startsWith('/') || API_BASE_URL === null) return url;
  return `${API_BASE_URL}${url}`;
}
