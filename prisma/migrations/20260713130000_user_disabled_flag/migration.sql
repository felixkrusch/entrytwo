-- Add disabled flag for account disablement (security / audit)
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
