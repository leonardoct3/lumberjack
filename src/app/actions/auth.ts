"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/auth/cookie";

export async function actionLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  redirect("/login");
}
