ALTER TABLE "User"
ADD COLUMN "totpLastUsedStep" BIGINT;

CREATE TABLE "TotpRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TotpRecoveryCode_userId_hash_key" ON "TotpRecoveryCode"("userId", "hash");
CREATE INDEX "TotpRecoveryCode_userId_idx" ON "TotpRecoveryCode"("userId");
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
