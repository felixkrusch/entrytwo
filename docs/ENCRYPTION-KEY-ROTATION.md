# Encryption Key Rotation Procedure

`ENCRYPTION_KEY` is a 64-hex-character (32-byte) AES-256-GCM key used to encrypt:
- Bank feed credentials (BankConnection.credentials)
- Any future encrypted secrets stored as ciphertext in the DB

The key is **never** stored in the database. It must be identical on every restore of a backup that contains encrypted data.

## When to rotate
- Suspected or confirmed compromise of the current key.
- Scheduled rotation (e.g. annually) as part of your security policy.
- Moving a production installation to a new host where you want a fresh key (requires re-encrypting credentials).

## Pre-requisites
- You have a recent, verified backup (see below).
- You have tested a clean restore on a throw-away environment using the current key.
- You can take the system offline for a short maintenance window (or run with read-only traffic).

## Step-by-step rotation (zero data loss when followed)

1. **Backup first (mandatory)**
   - Trigger a full portable backup from Admin → Backup.
   - Download the `.etbackup` archive and store it off-host.
   - Verify the backup manifest passes integrity checks on a separate machine.

2. **Prepare the new key**
   - Generate a fresh 32-byte key:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - Store the new key securely (password manager, secrets store). Do **not** commit it.

3. **Take a snapshot of current encrypted data (optional but recommended)**
   - If you have many bank connections, note which ones exist so you can re-validate after rotation.

4. **Stop mutating traffic (recommended)**
   - Put the instance in maintenance mode or stop the job worker.
   - Prevent new bank syncs / credential updates during the window.

5. **Re-encrypt credentials under the new key**
   - Use the built-in one-time rotation script (or run the equivalent manually):
     ```bash
     # Example (adapt to your environment)
     ENCRYPTION_KEY_OLD="OLD64HEX..." \
     ENCRYPTION_KEY_NEW="NEW64HEX..." \
     node scripts/rotate-encryption-key.mjs
     ```
   - The script will:
     - Read each BankConnection.credentials using the OLD key.
     - Re-encrypt using the NEW key.
     - Update the row in a transaction.
     - Verify round-trip decrypt before committing.
   - If any row fails, the script aborts and leaves the database unchanged.

6. **Update the environment**
   - Replace `ENCRYPTION_KEY` with the new value on **all** instances (app + any sidecar workers).
   - Do **not** keep the old key in the running environment after successful rotation.

7. **Restart and validate**
   - Restart the app and worker.
   - Trigger a bank feed sync (or manual re-auth) for one connection and confirm it succeeds.
   - Run a small journal entry and a backup/restore smoke test.
   - Check `/api/health` shows green and no missing secrets.

8. **Update your backup / DR documentation**
   - Record the date and fingerprint of the key that was active when the next backup was taken.
   - Update any runbooks that mention “original encryption key required for restore”.

9. **Cleanup**
   - Securely destroy the old key material (or move it to long-term offline storage if required by policy).
   - Remove any temporary `ENCRYPTION_KEY_OLD` variables.

## If you only have the new key and an old backup
- You **cannot** restore an old backup that was created with a different `ENCRYPTION_KEY`.
- The manifest contains `encryptionKeyFingerprint`; restore will fail with a clear error.
- Plan: keep the previous key in a sealed offline envelope for the lifetime of any backup that still depends on it, or re-encrypt the backup contents before archiving (advanced).

## Rollback plan
- If rotation partially fails:
  1. Stop the app.
  2. Restore the pre-rotation database from the verified backup (using the **old** key).
  3. Re-apply the old `ENCRYPTION_KEY`.
  4. Investigate the failing row(s) before retrying.

## Testing the procedure
- Run the full rotation on a staging clone at least once per quarter.
- After rotation, perform a clean restore into an empty environment and confirm:
  - Login works.
  - At least one bank connection can be used / re-synced.
  - A new backup can be created and validated.

## Automation notes
- The rotation script must be idempotent and must never log key material.
- Prefer running it via a one-off container/job that receives both keys via a short-lived secret mount.
- After rotation, trigger an automated integration test that exercises a webhook and a recurring job.

Keep this document with your runbooks. Update it whenever the rotation tooling or schema changes.
