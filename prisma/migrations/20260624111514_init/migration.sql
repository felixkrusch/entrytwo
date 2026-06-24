-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_REVERSED', 'ACCOUNT_CREATED', 'CONTACT_CREATED', 'AI_ACTION_EXECUTED', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ACCOUNTANT', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "debit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "credit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "description" TEXT,
    "taxRateId" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
