"use server";

import type { SenderRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/db/client";

const ROLES = new Set<SenderRole>(["admin", "pista", "unknown"]);

export async function setGroupListen(id: string, listen: boolean): Promise<void> {
  await prisma.group.update({
    where: { id },
    data: { listen },
  });
}

export async function setSenderRole(id: string, role: SenderRole): Promise<void> {
  await prisma.sender.update({
    where: { id },
    data: { role },
  });
}

export async function actionSetGroupListen(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const listen = String(formData.get("listen") ?? "") === "1";
  if (!id) return;
  await setGroupListen(id, listen);
  revalidatePath("/setup");
}

export async function actionSetSenderRole(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!id || !ROLES.has(roleRaw as SenderRole)) return;
  await setSenderRole(id, roleRaw as SenderRole);
  revalidatePath("/setup");
}
