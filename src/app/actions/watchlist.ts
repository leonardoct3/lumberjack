"use server";

import { revalidatePath } from "next/cache";
import { verifyOperatorSession } from "@/auth/session";
import { closeLot, moveWatchlist, removeFromWatchlist } from "@/catalog/watchlist";
import { prisma } from "@/db/client";
import { formEnum, formId } from "@/lib/form";

export async function actionMoveWatchlist(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const direction = formEnum(formData, "direction", ["up", "down"] as const);
  await moveWatchlist(prisma, partyId, direction);
  revalidatePath("/watchlist");
}

export async function actionRemoveFromWatchlist(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  await removeFromWatchlist(prisma, partyId);
  revalidatePath("/watchlist");
}

export async function actionCloseLot(formData: FormData) {
  await verifyOperatorSession();
  const lotId = formId(formData, "lotId");
  await closeLot(prisma, lotId, new Date());
  revalidatePath("/watchlist");
}
