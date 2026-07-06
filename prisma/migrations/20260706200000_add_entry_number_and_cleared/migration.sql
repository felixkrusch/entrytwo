-- Add human-readable journal entry reference numbers (JE-YYYY-NNNN) and line-level
-- reconciliation "cleared" flag.

-- 1. New column on JournalLine for bank reconciliation.
ALTER TABLE "JournalLine" ADD COLUMN "cleared" BOOLEAN NOT NULL DEFAULT false;

-- 2. New column on JournalEntry for the human reference.
ALTER TABLE "JournalEntry" ADD COLUMN "entryNumber" TEXT;

-- 3. Backfill entryNumber for existing entries, ordered by date then creation time,
--    using a per-year sequence (JE-YYYY-NNNN).
WITH ordered AS (
  SELECT
    id,
    "entryNumber",
    TO_CHAR("date", 'YYYY') AS yr,
    ROW_NUMBER() OVER (
      PARTITION BY TO_CHAR("date", 'YYYY')
      ORDER BY "date" ASC, "createdAt" ASC, id ASC
    ) AS rn
  FROM "JournalEntry"
)
UPDATE "JournalEntry" e
SET "entryNumber" = CONCAT('JE-', o.yr, '-', LPAD(o.rn::text, 4, '0'))
FROM ordered o
WHERE e.id = o.id;

-- 4. Unique index to enforce uniqueness (matches @unique in the schema).
CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");
