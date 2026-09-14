import { assertAuthConfigured } from "@/auth/cookie";

export async function register(): Promise<void> {
  assertAuthConfigured();
}
