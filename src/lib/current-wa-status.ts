import { cache } from "react";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";

/** Shares the same live session read between the shell and Setup in one render. */
export const currentWaStatus = cache(() => readWaStatus(prisma));
