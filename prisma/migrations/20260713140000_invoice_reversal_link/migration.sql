-- Add link from Invoice to its reversing journal entry (credit note / cancellation)
ALTER TABLE "Invoice" ADD COLUMN "reversedJournalEntryId" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_reversedJournalEntryId_idx" ON "Invoice"("reversedJournalEntryId");
