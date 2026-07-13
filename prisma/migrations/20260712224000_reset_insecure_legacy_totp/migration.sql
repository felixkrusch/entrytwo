-- TOTP values created before RFC 6238 verification was introduced were not
-- cryptographically verified or encrypted and must not remain trusted.
UPDATE "User"
SET "totpEnabled" = false,
    "totpSecret" = NULL,
    "totpLastUsedStep" = NULL
WHERE "totpEnabled" = true OR "totpSecret" IS NOT NULL;
