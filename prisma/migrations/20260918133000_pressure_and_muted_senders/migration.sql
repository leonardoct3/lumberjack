-- AlterTable
ALTER TABLE "HeatSnapshot" DROP COLUMN "score",
ADD COLUMN     "uniqueDemandSenders1d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uniqueDemandSenders3d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uniqueOfferSenders1d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uniqueOfferSenders3d" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uniqueOfferSenders7d" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sender" ADD COLUMN     "muted" BOOLEAN NOT NULL DEFAULT false;

