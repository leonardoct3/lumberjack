import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { confirmCandidate } from "@/catalog/confirm";
import { rejectCandidate } from "@/catalog/reject";
import { prisma } from "@/db/client";
import { zonedParts } from "@/domain/timezone";
import { ingestRawMessage, type RawMessageInput } from "@/ingest/ingest";
import { refreshHeat } from "@/jobs/refresh-heat";

const GROUP_WA_ID = "g-ingressos";
const GROUP_NAME = "ingressos";
const ADMIN_WA_ID = "s-admin";
const PISTA_WA_ID = "s-pista";
const PARTY_NAME = "ONIX";

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

function formatSpDate(value: Date): string {
  const { year, month, day } = zonedParts(value);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function adminInput(
  waMessageId: string,
  text: string,
  sentAt: Date,
): RawMessageInput {
  return {
    waMessageId,
    groupWaId: GROUP_WA_ID,
    groupName: GROUP_NAME,
    senderWaId: ADMIN_WA_ID,
    senderName: "Admin",
    sentAt,
    text,
    senderIsGroupAdmin: true,
  };
}

function pistaInput(
  waMessageId: string,
  text: string,
  sentAt: Date,
): RawMessageInput {
  return {
    waMessageId,
    groupWaId: GROUP_WA_ID,
    groupName: GROUP_NAME,
    senderWaId: PISTA_WA_ID,
    senderName: "Pista",
    sentAt,
    text,
  };
}

async function resetFixture(db: PrismaClient): Promise<void> {
  await db.heatSnapshot.deleteMany();
  await db.signal.deleteMany();
  await db.lot.deleteMany();
  await db.partyCandidate.deleteMany();
  await db.message.deleteMany();
  await db.party.deleteMany();
  await db.sender.deleteMany();
  await db.group.deleteMany();
}

async function confirmFromMessage(
  db: PrismaClient,
  messageId: string,
  now: Date,
): Promise<void> {
  const candidate = await db.partyCandidate.findFirstOrThrow({
    where: { sourceMessageId: messageId },
  });
  if (!candidate.name || !candidate.eventAt) {
    throw new Error("seed candidate is missing name or eventAt");
  }
  await confirmCandidate(db, {
    candidateId: candidate.id,
    name: candidate.name,
    eventAt: candidate.eventAt,
    lotLabel: candidate.lotLabel ?? undefined,
    url: candidate.url ?? undefined,
    officialPrice: candidate.officialPrice ?? undefined,
    platform: candidate.platform,
  }, now);
}

export async function seedFixture(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<void> {
  await resetFixture(db);

  const pastDate = addDays(now, -45);
  const upcomingDate = addDays(now, 30);
  const recent = addDays(now, -2);

  const pastPromo = await ingestRawMessage(
    db,
    adminInput(
      "seed-admin-past",
      `${PARTY_NAME}\n1º lote R$ 70 ${formatSpDate(pastDate)} https://www.sympla.com.br/onix-ago`,
      addDays(now, -50),
    ),
  );
  await confirmFromMessage(db, pastPromo.messageId, now);

  const upcomingPromo = await ingestRawMessage(
    db,
    adminInput(
      "seed-admin-upcoming",
      `${PARTY_NAME}\n1º lote R$ 80 ${formatSpDate(upcomingDate)} https://www.sympla.com.br/onix`,
      addDays(now, -3),
    ),
  );
  await confirmFromMessage(db, upcomingPromo.messageId, now);

  const rest: RawMessageInput[] = [
    adminInput("seed-admin-ruido-1", "bom dia galera", recent),
    adminInput("seed-admin-ruido-2", "quem vai hj?", recent),
    adminInput("seed-admin-ruido-3", "festa confirmada pessoal", recent),
    pistaInput("seed-procura-1", "procuro pista onix sexta", recent),
    pistaInput("seed-procura-2", "preciso ingresso onix", recent),
    pistaInput("seed-procura-3", "quero comprar onix", recent),
    pistaInput("seed-procura-4", "alguem tem onix?", recent),
    pistaInput("seed-procura-5", "alguem com onix lote", recent),
    pistaInput("seed-oferta-1", "vendo onix extra", recent),
    pistaInput("seed-oferta-2", "tenho extra onix", recent),
    pistaInput("seed-oferta-3", "saida onix hoje", recent),
    pistaInput("seed-oferta-4", "revendo onix", recent),
    pistaInput("seed-ruido-1", "kkkkk", recent),
    pistaInput("seed-ruido-2", "boa noite", recent),
    pistaInput("seed-ruido-3", "olha o link https://www.sympla.com.br/x", recent),
    pistaInput("seed-ruido-4", "festa top", recent),
    pistaInput("seed-ruido-5", "mandou bem", recent),
    pistaInput("seed-ruido-6", "ate mais", recent),
  ];

  for (const input of rest) {
    await ingestRawMessage(db, input);
  }

  await db.group.update({
    where: { waId: GROUP_WA_ID },
    data: { listen: true },
  });
  await db.sender.update({
    where: { waId: PISTA_WA_ID },
    data: { role: "pista" },
  });

  const leftovers = await db.partyCandidate.findMany({
    where: { status: "pending" },
  });
  for (const leftover of leftovers) {
    await rejectCandidate(db, leftover.id);
  }

  await refreshHeat(db, now);
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    await seedFixture(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
