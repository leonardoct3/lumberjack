"use server";

import { revalidatePath } from "next/cache";
import { confirmCandidate } from "@/catalog/confirm";
import { linkOrphan } from "@/catalog/link-orphan";
import { rejectCandidate } from "@/catalog/reject";
import { prisma } from "@/db/client";

export async function actionConfirmCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const eventAtRaw = String(formData.get("eventAt") ?? "");
  const lotLabel = optionalString(formData.get("lot"));
  const url = optionalString(formData.get("url"));
  const priceRaw = optionalString(formData.get("price"));
  const notaRaw = optionalString(formData.get("nota"));

  await confirmCandidate(prisma, {
    candidateId,
    name,
    eventAt: parseEventAt(eventAtRaw),
    lotLabel,
    url,
    officialPrice: priceRaw != null ? Number(priceRaw) : undefined,
    qualitativeScore: notaRaw != null ? Number(notaRaw) : undefined,
  }, new Date());
  revalidatePath("/inbox");
}

export async function actionRejectCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  await rejectCandidate(prisma, candidateId);
  revalidatePath("/inbox");
}

export async function actionLinkOrphan(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  await linkOrphan(prisma, { messageId, partyId });
  revalidatePath("/inbox");
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

function parseEventAt(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw}:00-03:00`);
  }
  return new Date(raw);
}
