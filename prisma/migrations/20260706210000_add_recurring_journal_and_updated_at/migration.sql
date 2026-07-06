-- Add updatedAt to JournalEntry and the RecurringJournalEntry schedule table.

ALTER TABLE "JournalEntry" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "RecurringJournalEntry" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "startDate" TIMESTAMP(3) NOT NULL,
  "nextDueDate" TIMESTAMP(3) NOT NULL,
  "lastGeneratedAt" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "autoPost" BOOLEAN NOT NULL DEFAULT false,
  "templateData" JSONB NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecurringJournalEntry_pkey" PRIMARY KEY ("id")
);
