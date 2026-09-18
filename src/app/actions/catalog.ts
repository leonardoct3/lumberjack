"use server";

import { revalidatePath } from "next/cache";
import { verifyOperatorSession } from "@/auth/session";
import { confirmCandidate } from "@/catalog/confirm";
import { createPartyFromMessage } from "@/catalog/create-party-from-message";
import { dismissOrphan, restoreOrphan } from "@/catalog/dismiss-orphan";
import { linkOrphan, linkOrphans } from "@/catalog/link-orphan";
import { reclassifyMessage } from "@/catalog/reclassify-message";
import { rejectCandidate } from "@/catalog/reject";
import { prisma } from "@/db/client";
import {
  formAliases,
  formDateTime,
  formEnum,
  formId,
  formIds,
  optionalFiniteNumber,
  optionalFormText,
  optionalUrl,
  requiredFormText,
} from "@/lib/form";

export async function actionConfirmCandidate(formData: FormData) {
  await verifyOperatorSession();
  const candidateId = formId(formData, "candidateId");
  const name = requiredFormText(formData, "name");
  const lotLabel = optionalFormText(formData, "lot");
  const url = optionalUrl(formData, "url");

  await confirmCandidate(
    prisma,
    {
      candidateId,
      name,
      eventAt: formDateTime(formData, "eventAt"),
      lotLabel,
      url,
      officialPrice: optionalFiniteNumber(formData, "price", { min: 0 }),
      qualitativeScore: optionalFiniteNumber(formData, "nota", { min: 1, max: 5 }),
    },
    new Date(),
  );
  revalidatePath("/inbox");
}

export async function actionRejectCandidate(formData: FormData) {
  await verifyOperatorSession();
  const candidateId = formId(formData, "candidateId");
  await rejectCandidate(prisma, candidateId);
  revalidatePath("/inbox");
}

export async function actionLinkOrphan(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  const partyId = formId(formData, "partyId");
  await linkOrphan(prisma, { messageId, partyId });
  revalidatePath("/inbox");
}

export async function actionLinkOrphans(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const messageIds = formIds(formData, "messageIds");
  await linkOrphans(prisma, { messageIds, partyId });
  revalidatePath("/inbox");
}

export async function actionCreatePartyFromMessage(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  const name = requiredFormText(formData, "name");

  await createPartyFromMessage(
    prisma,
    {
      messageId,
      name,
      eventAt: formDateTime(formData, "eventAt"),
      aliases: formAliases(formData, "aliases"),
    },
    new Date(),
  );
  revalidatePath("/inbox");
  revalidatePath("/heat");
}

export async function actionDismissOrphan(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  await dismissOrphan(prisma, messageId, new Date());
  revalidatePath("/inbox");
}

export async function actionRestoreOrphan(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  await restoreOrphan(prisma, messageId);
  revalidatePath("/inbox");
}

export async function actionReclassifyMessage(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  const next = formEnum(formData, "class", ["pista_oferta", "pista_procura"] as const);

  await reclassifyMessage(prisma, messageId, next);
  revalidatePath("/inbox");
}
