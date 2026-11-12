-- CreateEnum
CREATE TYPE "ResolutionDecision" AS ENUM ('link', 'new_event', 'abstain', 'not_mentioned');

-- AlterEnum
ALTER TYPE "ProcessingStage" ADD VALUE 'resolve';

-- CreateTable
CREATE TABLE "ResolutionProposal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "decision" "ResolutionDecision" NOT NULL,
    "partyId" TEXT,
    "candidates" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResolutionProposal_messageId_idx" ON "ResolutionProposal"("messageId");

-- CreateIndex
CREATE INDEX "ResolutionProposal_partyId_idx" ON "ResolutionProposal"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionProposal_runId_observationId_key" ON "ResolutionProposal"("runId", "observationId");

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InterpretationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

