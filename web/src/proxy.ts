import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// A free ngrok tunnel answers browser-like requests with a warning page. When this app runs on Vercel and
// API_INTERNAL_URL points at a tunnel, the /api rewrite would return that HTML. Skip the warning page.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("ngrok-skip-browser-warning", "1");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
