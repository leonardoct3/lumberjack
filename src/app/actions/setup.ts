"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/db/client";

export async function setGroupListen(id: string, listen: boolean): Promise<void> {
  await prisma.group.update({
    where: { id },
    data: { listen },
  });
}

export async function actionSetGroupListen(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const listen = String(formData.get("listen") ?? "") === "1";
  if (!id) return;
  await setGroupListen(id, listen);
  revalidatePath("/setup");
}

/**
 * Silencing is about what a sender's messages do, not about the sender, so past
 * rows are left where they are: the operator can still reject the candidates
 * already in the queue, and nothing already linked is taken away.
 */
export async function actionSetSenderMuted(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const muted = String(formData.get("muted") ?? "") === "1";
  if (!id) return;
  await prisma.sender.update({ where: { id }, data: { muted } });
  revalidatePath("/setup");
  revalidatePath("/inbox");
}
