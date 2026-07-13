CREATE TABLE "FileAsset" (
  "id" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storage" TEXT NOT NULL DEFAULT 'local',
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");
CREATE INDEX "FileAsset_sha256_idx" ON "FileAsset"("sha256");
CREATE INDEX "FileAsset_createdById_createdAt_idx" ON "FileAsset"("createdById", "createdAt");
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "JournalAttachment_journalEntryId_path_key";
DROP INDEX IF EXISTS "JournalAttachment_path_idx";
ALTER TABLE "JournalAttachment"
  ADD COLUMN "fileAssetId" TEXT NOT NULL,
  DROP COLUMN "path",
  DROP COLUMN "originalName",
  DROP COLUMN "mimeType",
  DROP COLUMN "size",
  DROP COLUMN "sha256";
CREATE UNIQUE INDEX "JournalAttachment_journalEntryId_fileAssetId_key" ON "JournalAttachment"("journalEntryId", "fileAssetId");
CREATE INDEX "JournalAttachment_fileAssetId_idx" ON "JournalAttachment"("fileAssetId");
ALTER TABLE "JournalAttachment" ADD CONSTRAINT "JournalAttachment_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry" DROP COLUMN "sourcePdfPath";

DROP INDEX IF EXISTS "ExpenseClaimReceipt_storageKey_key";
DROP INDEX IF EXISTS "ExpenseClaimReceipt_claimId_sha256_key";
DROP INDEX IF EXISTS "ExpenseClaimReceipt_sha256_idx";
ALTER TABLE "ExpenseClaimReceipt"
  ADD COLUMN "fileAssetId" TEXT NOT NULL,
  DROP COLUMN "storageKey",
  DROP COLUMN "originalName",
  DROP COLUMN "mimeType",
  DROP COLUMN "size",
  DROP COLUMN "sha256";
CREATE UNIQUE INDEX "ExpenseClaimReceipt_claimId_fileAssetId_key" ON "ExpenseClaimReceipt"("claimId", "fileAssetId");
CREATE INDEX "ExpenseClaimReceipt_fileAssetId_idx" ON "ExpenseClaimReceipt"("fileAssetId");
ALTER TABLE "ExpenseClaimReceipt" ADD CONSTRAINT "ExpenseClaimReceipt_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
