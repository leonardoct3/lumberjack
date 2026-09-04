import { redirect } from "next/navigation";
import { homeDestination } from "@/catalog/watchlist";
import { prisma } from "@/db/client";

export default async function Home() {
  redirect(await homeDestination(prisma));
}
