"use server";

import { revalidatePath } from "next/cache";
import type { PartyStatus, Platform } from "@prisma/client";
import { addLot, enqueueWatchlist, updateParty } from "@/catalog/party";
import { unlinkSignal } from "@/catalog/unlink";
import { closeLot } from "@/catalog/watchlist";
import { prisma } from "@/db/client";

const STATUSES = new Set<PartyStatus>(["upcoming", "past", "cancelled"]);
const PLATFORMS = new Set<Platform>([
  "sympla",
  "gandaya",
  "blacktag",
  "ingresse",
  "other",
  "unknown",
]);

export async function actionUpdateParty(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "");
  const status = STATUSES.has(statusRaw as PartyStatus)
    ? (statusRaw as PartyStatus)
    : "upcoming";
  const notaRaw = optionalString(formData.get("nota"));
  const notes = optionalString(formData.get("notes")) ?? null;

  await updateParty(prisma, {
    partyId,
    name,
    eventAt: parseEventAt(String(formData.get("eventAt") ?? "")),
    status,
    aliases: parseAliases(String(formData.get("aliases") ?? "")),
    qualitativeScore: notaRaw != null ? Number(notaRaw) : null,
    notes,
  });
  revalidateParty(partyId);
}

export async function actionAddLot(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const url = optionalString(formData.get("url"));
  const priceRaw = optionalString(formData.get("price"));
  const platformRaw = String(formData.get("platform") ?? "unknown");
  const platform = PLATFORMS.has(platformRaw as Platform)
    ? (platformRaw as Platform)
    : "unknown";

  await addLot(prisma, {
    partyId,
    label,
    url,
    price: priceRaw != null ? Number(priceRaw) : undefined,
    platform,
  });
  revalidateParty(partyId);
}

export async function actionUnlinkSignal(formData: FormData) {
  const signalId = String(formData.get("signalId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  await unlinkSignal(prisma, signalId);
  revalidateParty(partyId);
}

export async function actionCloseLot(formData: FormData) {
  const lotId = String(formData.get("lotId") ?? "");
  const partyId = String(formData.get("partyId") ?? "");
  await closeLot(prisma, lotId, new Date());
  revalidateParty(partyId);
}

export async function actionEnqueueWatchlist(formData: FormData) {
  const partyId = String(formData.get("partyId") ?? "");
  await enqueueWatchlist(prisma, partyId);
  revalidateParty(partyId);
}

function revalidateParty(partyId: string) {
  revalidatePath("/heat");
  revalidatePath("/watchlist");
  if (partyId) revalidatePath(`/parties/${partyId}`);
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

function parseAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
}

function parseEventAt(raw: string): Date {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw}:00-03:00`);
  }
  return new Date(raw);
}
