"use server";

import { revalidatePath } from "next/cache";
import { confirmCandidate } from "@/catalog/confirm";
import { createPartyFromMessage } from "@/catalog/create-party-from-message";
import { dismissOrphan, restoreOrphan } from "@/catalog/dismiss-orphan";
import { linkOrphan, linkOrphans } from "@/catalog/link-orphan";
import { reclassifyMessage } from "@/catalog/reclassify-message";
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

export async function actionLinkOrphans(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  const messageIds = formData.getAll("messageIds").map((id) => String(id));
  await linkOrphans(prisma, { messageIds, partyId });
  revalidatePath("/inbox");
}

export async function actionCreatePartyFromMessage(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const eventAtRaw = String(formData.get("eventAt") ?? "");
  const aliasesRaw = optionalString(formData.get("aliases"));

  await createPartyFromMessage(
    prisma,
    {
      messageId,
      name,
      eventAt: parseEventAt(eventAtRaw),
      aliases: aliasesRaw ? parseAliases(aliasesRaw) : undefined,
    },
    new Date(),
  );
  revalidatePath("/inbox");
  revalidatePath("/heat");
}

export async function actionDismissOrphan(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  await dismissOrphan(prisma, messageId, new Date());
  revalidatePath("/inbox");
}

export async function actionRestoreOrphan(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  await restoreOrphan(prisma, messageId);
  revalidatePath("/inbox");
}

export async function actionReclassifyMessage(formData: FormData) {
  const messageId = String(formData.get("messageId") ?? "");
  const next = String(formData.get("class") ?? "");
  if (next !== "pista_oferta" && next !== "pista_procura") return;

  await reclassifyMessage(prisma, messageId, next);
  revalidatePath("/inbox");
}

function parseAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
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
