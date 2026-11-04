import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/db/client";
import { startOfDaySp } from "@/domain/timezone";
import { workerId } from "@/jobs/main";
import { loadPipelineConfig } from "@/pipeline/config";
import { interpreterFor } from "@/pipeline/interpreters";
import { processInterpretation } from "@/pipeline/process";
import { enqueueInterpretation } from "@/pipeline/queue";
import { pipelineStatus } from "@/pipeline/status";

const USAGE = `Usage: npm run pipeline -- <command> [options]

  status                                  queue, capture and spend, as counts only
  enqueue --from YYYY-MM-DD --to YYYY-MM-DD   queue stored messages capture never queued
  run                                     one interpretation pass, as the worker does

Dates are São Paulo calendar days; --to is exclusive. Flags come from PIPELINE_* in the
environment, and "run" does nothing while PIPELINE_INTERPRET is off.`;

function spDay(name: string): Date {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`${name} must be YYYY-MM-DD.\n\n${USAGE}`);
  return startOfDaySp(new Date(`${value}T12:00:00Z`));
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  status: async () => {
    const config = loadPipelineConfig();
    print({ config, ...(await pipelineStatus(prisma, new Date())) });
  },
  enqueue: async () => {
    const window = { from: spDay("--from"), to: spDay("--to") };
    if (window.to <= window.from) throw new Error("--to must come after --from");
    print(await enqueueInterpretation(prisma, window));
  },
  run: async () => {
    const config = loadPipelineConfig();
    print(
      await processInterpretation(prisma, {
        config,
        interpreter: interpreterFor(config),
        owner: workerId(),
      }),
    );
  },
};

async function main(): Promise<void> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (!command) throw new Error(USAGE);
  try {
    await command();
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
