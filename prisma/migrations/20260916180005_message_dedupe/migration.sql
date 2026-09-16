-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "fingerprint" TEXT;

-- CreateIndex
CREATE INDEX "Message_senderId_fingerprint_sentAt_idx" ON "Message"("senderId", "fingerprint", "sentAt");

-- CreateIndex
CREATE INDEX "Message_duplicateOfId_idx" ON "Message"("duplicateOfId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
