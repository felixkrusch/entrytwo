ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "parentEventId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "introducedByEventId" TEXT;

CREATE TABLE IF NOT EXISTS "AgentMemory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentMemory_scope_idx" ON "AgentMemory"("scope");
CREATE INDEX IF NOT EXISTS "AgentMemory_key_idx" ON "AgentMemory"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMemory_scope_key_key" ON "AgentMemory"("scope", "key");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Event_parentEventId_fkey') THEN
    ALTER TABLE "Event" ADD CONSTRAINT "Event_parentEventId_fkey"
      FOREIGN KEY ("parentEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
