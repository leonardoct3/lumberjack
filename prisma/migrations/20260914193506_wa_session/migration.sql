-- CreateEnum
CREATE TYPE "WaState" AS ENUM ('connected', 'qr', 'disconnected');

-- CreateTable
CREATE TABLE "WaSession" (
    "id" TEXT NOT NULL DEFAULT 'wa',
    "state" "WaState" NOT NULL DEFAULT 'disconnected',
    "detail" TEXT,
    "qr" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);
