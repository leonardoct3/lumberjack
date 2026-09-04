-- CreateEnum
CREATE TYPE "SenderRole" AS ENUM ('admin', 'pista', 'unknown');

-- CreateEnum
CREATE TYPE "MessageClass" AS ENUM ('admin_promo', 'pista_oferta', 'pista_procura', 'ruido');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('pending', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('upcoming', 'past', 'cancelled');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('sympla', 'gandaya', 'blacktag', 'ingresse', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('offer', 'demand');

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sender" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT,
    "role" "SenderRole" NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "class" "MessageClass",
    "partyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyCandidate" (
    "id" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'pending',
    "name" TEXT,
    "url" TEXT,
    "lotLabel" TEXT,
    "officialPrice" DOUBLE PRECISION,
    "eventAt" TIMESTAMP(3),
    "platform" "Platform" NOT NULL DEFAULT 'unknown',
    "sourceMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "eventAt" TIMESTAMP(3) NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'upcoming',
    "qualitativeScore" INTEGER,
    "watchlistPosition" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "officialPrice" DOUBLE PRECISION,
    "url" TEXT,
    "platform" "Platform" NOT NULL DEFAULT 'unknown',

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "type" "SignalType" NOT NULL,
    "partyId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatSnapshot" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "demand1d" INTEGER NOT NULL,
    "demand3d" INTEGER NOT NULL,
    "demand7d" INTEGER NOT NULL,
    "offer1d" INTEGER NOT NULL,
    "offer3d" INTEGER NOT NULL,
    "offer7d" INTEGER NOT NULL,
    "uniqueDemandSenders7d" INTEGER NOT NULL,
    "daysToEvent" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "HeatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_waId_key" ON "Group"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_waId_key" ON "Sender"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyCandidate_sourceMessageId_key" ON "PartyCandidate"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_messageId_key" ON "Signal"("messageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyCandidate" ADD CONSTRAINT "PartyCandidate_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatSnapshot" ADD CONSTRAINT "HeatSnapshot_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
