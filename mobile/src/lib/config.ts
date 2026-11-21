// The only env var the app reads. It is public: never put a secret in EXPO_PUBLIC_*.
// Must be accessed statically so Metro inlines it.
const rawBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

export const API_BASE_URL: string | null =
  rawBaseUrl && rawBaseUrl.trim().length > 0 ? rawBaseUrl.trim().replace(/\/+$/, '') : null;
