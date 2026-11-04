import { hostname } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/db/client";
import { isListenDay } from "@/domain/timezone";
import { markPastParties } from "@/jobs/mark-past";
import { refreshHeat } from "@/jobs/refresh-heat";
import { loadPipelineConfig, type PipelineConfig } from "@/pipeline/config";
import { interpreterFor } from "@/pipeline/interpreters";
import { processInterpretation, type PassReport } from "@/pipeline/process";

export function workerId(): string {
  return `worker:${hostname()}:${process.pid}`;
}

/**
 * The board's own jobs run first and never depend on the pipeline: flags are
 * read only after them, so a bad flag cannot stop the heat from refreshing.
 */
export async function runWorkerOnce(
  db: PrismaClient,
  now: Date,
  loadPipeline: () => PipelineConfig = () => loadPipelineConfig({}),
): Promise<PassReport | null> {
  void isListenDay(now);
  await markPastParties(db, now);
  await refreshHeat(db, now);

  const config = loadPipeline();
  if (config.interpret === "off") return null;
  return processInterpretation(db, { config, interpreter: interpreterFor(config), owner: workerId() });
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    const report = await runWorkerOnce(prisma, new Date(), () => loadPipelineConfig());
    if (report) console.log("interpretation pass", JSON.stringify(report));
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
