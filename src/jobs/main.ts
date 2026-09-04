import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/db/client";
import { isListenDay } from "@/domain/timezone";
import { markPastParties } from "@/jobs/mark-past";
import { refreshHeat } from "@/jobs/refresh-heat";

export async function runWorkerOnce(db: PrismaClient, now: Date): Promise<void> {
  void isListenDay(now);
  await markPastParties(db, now);
  await refreshHeat(db, now);
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    await runWorkerOnce(prisma, new Date());
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
