"use server";

import { revalidatePath } from "next/cache";
import type { PartyStatus } from "@prisma/client";
import { verifyOperatorSession } from "@/auth/session";
import { discardParty } from "@/catalog/discard-party";
import { mergeParties } from "@/catalog/merge-parties";
import { addLot, enqueueWatchlist, updateLot, updateParty } from "@/catalog/party";
import { unlinkSignal } from "@/catalog/unlink";
import { closeLot } from "@/catalog/watchlist";
import { prisma } from "@/db/client";
import {
  formAliases,
  formDateTime,
  formEnum,
  formId,
  optionalFiniteNumber,
  optionalFormText,
  optionalUrl,
  requiredFormText,
} from "@/lib/form";

const STATUSES = [
  "upcoming",
  "past",
  "cancelled",
] as const satisfies readonly PartyStatus[];
const PLATFORMS = [
  "sympla",
  "gandaya",
  "blacktag",
  "ingresse",
  "other",
  "unknown",
] as const;

export async function actionUpdateParty(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const name = requiredFormText(formData, "name");
  const status = formEnum(formData, "status", STATUSES);
  const notes = optionalFormText(formData, "notes") ?? null;

  await updateParty(prisma, {
    partyId,
    name,
    eventAt: formDateTime(formData, "eventAt"),
    status,
    aliases: formAliases(formData, "aliases"),
    qualitativeScore:
      optionalFiniteNumber(formData, "nota", { min: 1, max: 5 }) ?? null,
    notes,
  });
  revalidateParty(partyId);
}

export async function actionAddLot(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  const label = requiredFormText(formData, "label");
  const url = optionalUrl(formData, "url");
  const platform = formEnum(formData, "platform", PLATFORMS);

  await addLot(prisma, {
    partyId,
    label,
    url,
    price: optionalFiniteNumber(formData, "price", { min: 0 }),
    platform,
  });
  revalidateParty(partyId);
}

export async function actionUpdateLot(formData: FormData) {
  await verifyOperatorSession();
  const lotId = formId(formData, "lotId");
  const partyId = formId(formData, "partyId");
  const label = requiredFormText(formData, "label");

  await updateLot(prisma, {
    lotId,
    label,
    url: optionalUrl(formData, "url") ?? null,
    price: optionalFiniteNumber(formData, "price", { min: 0 }) ?? null,
    platform: formEnum(formData, "platform", PLATFORMS),
  });
  revalidateParty(partyId);
}

export async function actionUnlinkSignal(formData: FormData) {
  await verifyOperatorSession();
  const signalId = formId(formData, "signalId");
  const partyId = formId(formData, "partyId");
  await unlinkSignal(prisma, signalId);
  revalidateParty(partyId);
}

export async function actionCloseLot(formData: FormData) {
  await verifyOperatorSession();
  const lotId = formId(formData, "lotId");
  const partyId = formId(formData, "partyId");
  await closeLot(prisma, lotId, new Date());
  revalidateParty(partyId);
}

export async function actionEnqueueWatchlist(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");
  await enqueueWatchlist(prisma, partyId);
  revalidateParty(partyId);
}

/** The current party is the duplicate: it folds into the chosen survivor. */
export async function actionMergeParty(formData: FormData) {
  await verifyOperatorSession();
  const sourceId = formId(formData, "partyId");
  const targetId = formId(formData, "targetId");
  if (sourceId === targetId) throw new Error("Escolha outra festa para fundir.");

  await mergeParties(prisma, { sourceId, targetId });
  revalidateParty(sourceId);
  revalidateParty(targetId);
  revalidatePath("/inbox");
}

export async function actionDiscardParty(formData: FormData) {
  await verifyOperatorSession();
  const partyId = formId(formData, "partyId");

  await discardParty(prisma, partyId);
  revalidateParty(partyId);
  revalidatePath("/inbox");
}

function revalidateParty(partyId: string) {
  revalidatePath("/heat");
  revalidatePath("/watchlist");
  if (partyId) revalidatePath(`/parties/${partyId}`);
}
