CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'SUCCEEDED', 'DEAD_LETTER');
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "OAuthAccount" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL, "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
  "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT,
  CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserInvitation" (
  "id" TEXT NOT NULL, "email" TEXT NOT NULL, "role" "Role" NOT NULL DEFAULT 'VIEWER', "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL, CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserInvitation_tokenHash_key" ON "UserInvitation"("tokenHash");
CREATE INDEX "UserInvitation_email_expiresAt_idx" ON "UserInvitation"("email", "expiresAt");
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AccountingPeriod" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3) NOT NULL,
  "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN', "closedAt" TIMESTAMP(3), "closedById" TEXT,
  "reopenReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingPeriod_startDate_endDate_key" ON "AccountingPeriod"("startDate", "endDate");
CREATE INDEX "AccountingPeriod_status_startDate_endDate_idx" ON "AccountingPeriod"("status", "startDate", "endDate");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DurableJob" (
  "id" TEXT NOT NULL, "type" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedAt" TIMESTAMP(3), "lockedBy" TEXT, "lastError" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DurableJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DurableJob_idempotencyKey_key" ON "DurableJob"("idempotencyKey");
CREATE INDEX "DurableJob_status_availableAt_idx" ON "DurableJob"("status", "availableAt");
CREATE INDEX "DurableJob_lockedAt_idx" ON "DurableJob"("lockedAt");

CREATE TABLE "JobAttempt" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), "error" TEXT, "workerId" TEXT NOT NULL, CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobAttempt_jobId_startedAt_idx" ON "JobAttempt"("jobId", "startedAt");
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DurableJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "externalId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
  "processedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");
CREATE INDEX "WebhookEvent_status_createdAt_idx" ON "WebhookEvent"("status", "createdAt");

CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL, "count" INTEGER NOT NULL, "resetAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
