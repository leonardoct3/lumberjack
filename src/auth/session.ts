import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, authDisabled, isValidSession } from "@/auth/cookie";

/**
 * The request-level authorization boundary for pages and Server Actions.
 * Proxy is intentionally only an optimistic redirect: actions must still
 * authenticate themselves because they are callable over their route's POST.
 */
export const verifyOperatorSession = cache(async (): Promise<void> => {
  if (authDisabled()) return;

  const token = (await cookies()).get(COOKIE)?.value;
  const secret = process.env.AUTH_PASSWORD ?? "";
  if (!isValidSession(token, secret, Date.now())) {
    redirect("/login");
  }
});
