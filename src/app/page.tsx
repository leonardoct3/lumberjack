import { redirect } from "next/navigation";
import { verifyOperatorSession } from "@/auth/session";
import { homeDestination } from "@/catalog/watchlist";
import { prisma } from "@/db/client";

export default async function Home() {
  await verifyOperatorSession();
  redirect(await homeDestination(prisma));
}
