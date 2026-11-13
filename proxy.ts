import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, safeEqual, sessionToken } from "@/lib/auth";

/** Sends visitors without a valid session to /login (pages) or answers 401 (API). */
export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await sessionToken())) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page itself, sign-in/health endpoints and static assets.
  matcher: ["/((?!login|api/login|api/health|_next/static|_next/image|icon\\.svg|favicon\\.ico).*)"],
};
