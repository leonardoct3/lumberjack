import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, authDisabled, isValidSession } from "@/auth/cookie";

export function middleware(request: NextRequest) {
  if (authDisabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const password = process.env.AUTH_PASSWORD ?? "";
  const token = request.cookies.get(COOKIE)?.value;
  if (isValidSession(token, password, password)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
