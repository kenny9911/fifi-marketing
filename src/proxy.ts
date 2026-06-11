import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getAuthSecretKey } from "@/server/crypto";

/**
 * Next 16 proxy (formerly middleware): optimistic auth gate for the app pages.
 * Verifies the session JWT with jose only — no DB access here. Role checks for
 * /admin happen server-side in the routes/pages themselves.
 */

const SESSION_COOKIE = "fifi_session";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, getAuthSecretKey(), { algorithms: ["HS256"] });
      return NextResponse.next();
    } catch {
      // invalid/expired token → treat as unauthenticated
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/studio/:path*", "/usage/:path*", "/settings/:path*", "/admin/:path*"],
};
