"use server";

import { revalidatePath } from "next/cache";
import { closeLot, moveWatchlist, removeFromWatchlist } from "@/catalog/watchlist";
import { prisma } from "@/db/client";

export async function actionMoveWatchlist(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "up" && direction !== "down") return;
  await moveWatchlist(prisma, partyId, direction);
  revalidatePath("/watchlist");
}

export async function actionRemoveFromWatchlist(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  await removeFromWatchlist(prisma, partyId);
  revalidatePath("/watchlist");
}

export async function actionCloseLot(formData: FormData) {
  const lotId = String(formData.get("lotId") ?? "");
  await closeLot(prisma, lotId, new Date());
  revalidatePath("/watchlist");
}
