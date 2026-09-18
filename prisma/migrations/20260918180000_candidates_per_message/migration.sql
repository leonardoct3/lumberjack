-- A promoter blast announces a whole season in one message, so the catalogue
-- queue needs a row per festa. The unique constraint allowed exactly one, which
-- is why festa two and three were dropped in silence.
DROP INDEX "PartyCandidate_sourceMessageId_key";

-- AlterTable
ALTER TABLE "PartyCandidate" ADD COLUMN     "excerpt" TEXT;

-- CreateIndex
CREATE INDEX "PartyCandidate_sourceMessageId_idx" ON "PartyCandidate"("sourceMessageId");
