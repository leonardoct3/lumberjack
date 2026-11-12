-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('link', 'new_event', 'doubt');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('linked', 'created', 'dismissed', 'undone');

-- CreateTable
CREATE TABLE "ProposalReview" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "chosenPartyId" TEXT,
    "suggestion" "SuggestionKind",
    "suggestedPartyId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalReview_messageId_idx" ON "ProposalReview"("messageId");

-- CreateIndex
CREATE INDEX "ProposalReview_createdAt_idx" ON "ProposalReview"("createdAt");

-- AddForeignKey
ALTER TABLE "ProposalReview" ADD CONSTRAINT "ProposalReview_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

