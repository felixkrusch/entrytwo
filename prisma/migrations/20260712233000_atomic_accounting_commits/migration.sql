ALTER TABLE "Event" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Event_idempotencyKey_key" ON "Event"("idempotencyKey");
