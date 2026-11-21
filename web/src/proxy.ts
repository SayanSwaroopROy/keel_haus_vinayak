import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// A free ngrok tunnel answers browser-like requests with a warning page. When this app runs on Vercel and
// API_INTERNAL_URL points at a tunnel, the /api rewrite would return that HTML, so rewrite here and set
// ngrok-skip-browser-warning on the request. Without API_INTERNAL_URL the next.config.ts rewrite handles /api.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("ngrok-skip-browser-warning", "1");

  const apiBase = process.env.API_INTERNAL_URL?.replace(/\/+$/, "");
  if (!apiBase) return NextResponse.next({ request: { headers } });

  const { pathname, search } = request.nextUrl;
  const upstreamPath = pathname.replace(/^\/api/, "");
  return NextResponse.rewrite(new URL(`${apiBase}${upstreamPath}${search}`), { request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
