CREATE TYPE "ExpenseClaimWorkflowStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ExpenseClaimPostingStatus" AS ENUM ('UNPOSTED', 'POSTED', 'REVERSED');
CREATE TYPE "ExpenseClaimReimbursementStatus" AS ENUM ('NOT_READY', 'READY', 'PARTIALLY_REIMBURSED', 'REIMBURSED');
CREATE TYPE "ExpenseClaimPaymentMethod" AS ENUM ('PERSONAL_FUNDS', 'COMPANY_CARD', 'CASH_ADVANCE', 'OTHER');
CREATE TYPE "ExpenseClaimDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

CREATE TABLE "ExpenseClaim" (
  "id" TEXT NOT NULL,
  "claimNumber" TEXT NOT NULL,
  "claimantUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "purpose" TEXT,
  "workflowStatus" "ExpenseClaimWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "postingStatus" "ExpenseClaimPostingStatus" NOT NULL DEFAULT 'UNPOSTED',
  "reimbursementStatus" "ExpenseClaimReimbursementStatus" NOT NULL DEFAULT 'NOT_READY',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedRevision" INTEGER,
  "baseCurrency" TEXT NOT NULL DEFAULT 'EUR',
  "totalBaseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "postedAt" TIMESTAMP(3),
  "postedByUserId" TEXT,
  "postedJournalEntryId" TEXT,
  "reimbursementAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseClaimLine" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "merchant" TEXT,
  "description" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "grossAmount" DECIMAL(65,30) NOT NULL,
  "netAmount" DECIMAL(65,30),
  "taxAmount" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "fxRateToBase" DECIMAL(65,30),
  "fxSource" TEXT,
  "fxDate" TIMESTAMP(3),
  "baseAmount" DECIMAL(65,30) NOT NULL,
  "taxRateId" TEXT,
  "taxIsInput" BOOLEAN NOT NULL DEFAULT true,
  "paymentMethod" "ExpenseClaimPaymentMethod" NOT NULL DEFAULT 'PERSONAL_FUNDS',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseClaimLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseClaimReceipt" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "uploadedByUserId" TEXT NOT NULL,
  "extractionStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "extractedData" JSONB,
  "duplicateStatus" TEXT NOT NULL DEFAULT 'CLEAR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseClaimLineReceipt" (
  "claimLineId" TEXT NOT NULL,
  "claimReceiptId" TEXT NOT NULL,
  CONSTRAINT "ExpenseClaimLineReceipt_pkey" PRIMARY KEY ("claimLineId", "claimReceiptId")
);

CREATE TABLE "ExpenseClaimApproval" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "approverUserId" TEXT NOT NULL,
  "decision" "ExpenseClaimDecision" NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseClaimActivity" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "payload" JSONB,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpenseClaimReimbursement" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseClaimReimbursement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseClaim_claimNumber_key" ON "ExpenseClaim"("claimNumber");
CREATE UNIQUE INDEX "ExpenseClaim_postedJournalEntryId_key" ON "ExpenseClaim"("postedJournalEntryId");
CREATE INDEX "ExpenseClaim_claimantUserId_workflowStatus_idx" ON "ExpenseClaim"("claimantUserId", "workflowStatus");
CREATE INDEX "ExpenseClaim_workflowStatus_postingStatus_reimbursementStatus_idx" ON "ExpenseClaim"("workflowStatus", "postingStatus", "reimbursementStatus");
CREATE INDEX "ExpenseClaim_createdAt_idx" ON "ExpenseClaim"("createdAt");
CREATE UNIQUE INDEX "ExpenseClaimLine_claimId_position_key" ON "ExpenseClaimLine"("claimId", "position");
CREATE INDEX "ExpenseClaimLine_accountId_idx" ON "ExpenseClaimLine"("accountId");
CREATE INDEX "ExpenseClaimLine_expenseDate_idx" ON "ExpenseClaimLine"("expenseDate");
CREATE UNIQUE INDEX "ExpenseClaimReceipt_storageKey_key" ON "ExpenseClaimReceipt"("storageKey");
CREATE UNIQUE INDEX "ExpenseClaimReceipt_claimId_sha256_key" ON "ExpenseClaimReceipt"("claimId", "sha256");
CREATE INDEX "ExpenseClaimReceipt_sha256_idx" ON "ExpenseClaimReceipt"("sha256");
CREATE INDEX "ExpenseClaimLineReceipt_claimReceiptId_idx" ON "ExpenseClaimLineReceipt"("claimReceiptId");
CREATE INDEX "ExpenseClaimApproval_claimId_revision_idx" ON "ExpenseClaimApproval"("claimId", "revision");
CREATE INDEX "ExpenseClaimActivity_claimId_createdAt_idx" ON "ExpenseClaimActivity"("claimId", "createdAt");
CREATE INDEX "ExpenseClaimReimbursement_claimId_paidAt_idx" ON "ExpenseClaimReimbursement"("claimId", "paidAt");

ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_claimantUserId_fkey" FOREIGN KEY ("claimantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_postedJournalEntryId_fkey" FOREIGN KEY ("postedJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_reimbursementAccountId_fkey" FOREIGN KEY ("reimbursementAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimLine" ADD CONSTRAINT "ExpenseClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimLine" ADD CONSTRAINT "ExpenseClaimLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimLine" ADD CONSTRAINT "ExpenseClaimLine_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimReceipt" ADD CONSTRAINT "ExpenseClaimReceipt_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimReceipt" ADD CONSTRAINT "ExpenseClaimReceipt_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimLineReceipt" ADD CONSTRAINT "ExpenseClaimLineReceipt_claimLineId_fkey" FOREIGN KEY ("claimLineId") REFERENCES "ExpenseClaimLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimLineReceipt" ADD CONSTRAINT "ExpenseClaimLineReceipt_claimReceiptId_fkey" FOREIGN KEY ("claimReceiptId") REFERENCES "ExpenseClaimReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimApproval" ADD CONSTRAINT "ExpenseClaimApproval_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimApproval" ADD CONSTRAINT "ExpenseClaimApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimActivity" ADD CONSTRAINT "ExpenseClaimActivity_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimActivity" ADD CONSTRAINT "ExpenseClaimActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimReimbursement" ADD CONSTRAINT "ExpenseClaimReimbursement_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimReimbursement" ADD CONSTRAINT "ExpenseClaimReimbursement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaimReimbursement" ADD CONSTRAINT "ExpenseClaimReimbursement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
