import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, authDisabled, isValidSession } from "@/auth/cookie";

export function proxy(request: NextRequest) {
  if (authDisabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_PASSWORD ?? "";
  const token = request.cookies.get(COOKIE)?.value;
  if (isValidSession(token, secret, Date.now())) {
    return NextResponse.next();
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  if (token) {
    response.cookies.delete(COOKIE);
  }
  return response;
}
