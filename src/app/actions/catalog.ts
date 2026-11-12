"use server";

import { revalidatePath } from "next/cache";
import { verifyOperatorSession } from "@/auth/session";
import { confirmCandidate } from "@/catalog/confirm";
import { createPartyFromMessage } from "@/catalog/create-party-from-message";
import { dismissOrphan, restoreOrphan } from "@/catalog/dismiss-orphan";
import { linkOrphan, linkOrphans } from "@/catalog/link-orphan";
import { reclassifyMessage } from "@/catalog/reclassify-message";
import { rejectCandidate } from "@/catalog/reject";
import { recordReviews, undoLinks } from "@/catalog/review";
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
import { inboxMode } from "@/pipeline/config";

/**
 * Feedback on what the Inbox suggested. It runs after the change and only logs on
 * failure: a lost record must not turn a completed link into an error toast.
 */
async function review(input: Parameters<typeof recordReviews>[1]): Promise<void> {
  if (inboxMode() !== "suggest") return;
  try {
    await recordReviews(prisma, input, new Date());
  } catch (err) {
    console.error(
      "inbox review not recorded:",
      err instanceof Error ? err.message : err,
    );
  }
}

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
  await review({ messageIds: [messageId], action: "linked", chosenPartyId: partyId });
  revalidatePath("/inbox");
}

/** Returns what it linked, so the toast can offer to take back exactly that. */
export async function actionLinkOrphans(
  formData: FormData,
): Promise<{ partyId: string; linkedIds: string[] }> {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const messageIds = formIds(formData, "messageIds");
  const { linkedIds } = await linkOrphans(prisma, { messageIds, partyId });
  await review({ messageIds: linkedIds, action: "linked", chosenPartyId: partyId });
  revalidatePath("/inbox");
  return { partyId, linkedIds };
}

export async function actionUndoLinks(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const messageIds = formIds(formData, "messageIds");
  const undone = await undoLinks(prisma, { partyId, messageIds });
  await review({ messageIds: undone, action: "undone", chosenPartyId: partyId });
  revalidatePath("/inbox");
}

export async function actionCreatePartyFromMessage(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  const name = requiredFormText(formData, "name");

  const { partyId } = await createPartyFromMessage(
    prisma,
    {
      messageId,
      name,
      eventAt: formDateTime(formData, "eventAt"),
      aliases: formAliases(formData, "aliases"),
    },
    new Date(),
  );
  await review({ messageIds: [messageId], action: "created", chosenPartyId: partyId });
  revalidatePath("/inbox");
  revalidatePath("/heat");
}

export async function actionDismissOrphan(formData: FormData) {
  await verifyOperatorSession();
  const messageId = formId(formData, "messageId");
  await dismissOrphan(prisma, messageId, new Date());
  await review({ messageIds: [messageId], action: "dismissed" });
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
