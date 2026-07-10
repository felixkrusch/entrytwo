ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'JOURNAL_ATTACHMENT_ADDED';

ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "sourcePdfPath" TEXT;

CREATE TABLE IF NOT EXISTS "JournalAttachment" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "JournalAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalAttachment_journalEntryId_fkey"
      FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "JournalAttachment_journalEntryId_path_key"
  ON "JournalAttachment"("journalEntryId", "path");
CREATE INDEX IF NOT EXISTS "JournalAttachment_journalEntryId_idx"
  ON "JournalAttachment"("journalEntryId");
CREATE INDEX IF NOT EXISTS "JournalAttachment_path_idx"
  ON "JournalAttachment"("path");

INSERT INTO "JournalAttachment" (
  "id", "journalEntryId", "path", "originalName", "mimeType", "size", "sha256", "source", "createdAt", "createdBy"
)
SELECT
  gen_random_uuid()::text,
  je."id",
  je."sourcePdfPath",
  regexp_replace(je."sourcePdfPath", '^.*/', ''),
  'application/octet-stream',
  0,
  'legacy-unverified',
  'legacy',
  je."createdAt",
  je."createdBy"
FROM "JournalEntry" je
WHERE je."sourcePdfPath" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "JournalAttachment" ja
    WHERE ja."journalEntryId" = je."id" AND ja."path" = je."sourcePdfPath"
  );
