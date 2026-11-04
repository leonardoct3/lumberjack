-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('interpret');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'dead');

-- CreateEnum
CREATE TYPE "FailureKind" AS ENUM ('transient', 'timeout', 'schema', 'refusal', 'budget', 'internal');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ObservationIntent" AS ENUM ('demand', 'offer', 'promotion', 'update', 'withdrawal_claim', 'unrelated', 'unresolved');

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "stage" "ProcessingStage" NOT NULL,
    "messageId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastErrorKind" "FailureKind",
    "lastError" TEXT,
    "resultRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterpretationRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "messageId" TEXT NOT NULL,
    "stage" "ProcessingStage" NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "interpreter" TEXT NOT NULL,
    "interpreterVersion" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "schemaVersion" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "failureKind" "FailureKind",
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterpretationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "intent" "ObservationIntent" NOT NULL,
    "eventMention" TEXT,
    "ticketCategory" TEXT,
    "quantity" INTEGER,
    "priceAmount" DOUBLE PRECISION,
    "priceCurrency" TEXT,
    "priceMeaning" TEXT,
    "eventYear" INTEGER,
    "eventMonth" INTEGER,
    "eventDay" INTEGER,
    "dateBasis" TEXT,
    "spans" JSONB NOT NULL,
    "relationshipKind" TEXT,
    "relatedMessageId" TEXT,
    "ambiguities" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_idempotencyKey_key" ON "ProcessingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_runAfter_idx" ON "ProcessingJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ProcessingJob_messageId_idx" ON "ProcessingJob"("messageId");

-- CreateIndex
CREATE INDEX "InterpretationRun_messageId_stage_idx" ON "InterpretationRun"("messageId", "stage");

-- CreateIndex
CREATE INDEX "InterpretationRun_stage_inputHash_contextHash_interpreter_i_idx" ON "InterpretationRun"("stage", "inputHash", "contextHash", "interpreter", "interpreterVersion");

-- CreateIndex
CREATE INDEX "InterpretationRun_createdAt_idx" ON "InterpretationRun"("createdAt");

-- CreateIndex
CREATE INDEX "Observation_messageId_idx" ON "Observation"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_runId_position_key" ON "Observation"("runId", "position");

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_resultRunId_fkey" FOREIGN KEY ("resultRunId") REFERENCES "InterpretationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterpretationRun" ADD CONSTRAINT "InterpretationRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterpretationRun" ADD CONSTRAINT "InterpretationRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InterpretationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
