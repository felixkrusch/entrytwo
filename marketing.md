# entrytwo — Technical Marketing Brief

**Tagline-ready positioning:**
The only accounting system that treats your books like a Git repository — with AI that actually posts high-confidence entries, full cryptographic auditability, and production-grade self-hosted operations.

entrytwo is a modern, double-entry accounting platform for companies that want **correct books without hiring a full-time bookkeeper**. It combines a true Git model of financial history, powerful AI autonomy, rock-solid security, and reliable self-hosted operations.

---

## 1. The Core Philosophy — "Git for Accounting"

entrytwo models the entire ledger as an immutable Git-like repository:

- **Every change is a commit** (JournalEntry) with full provenance.
- **Branches** for parallel realities ("what-if", AI reconciliation work, experiments).
- **Merges** that actually bring entries into the target ancestry (not just events).
- **Tags** for official states (month-end close, auditor snapshot, tax filing version).
- **Diff / Blame / Restore** at the account or full-books level.
- History is **never rewritten** — rollbacks and AI actions create new commits.

This is not marketing fluff — it is the enforced data model (`lib/accounting/ancestry.ts`, `getVisibleJournalEntryIds`, `mergeBranch`, `diffPoints`, `blameAccount`, `commitJournalAtomic`).

**Why it matters:** Auditors and owners get real, explainable, point-in-time truth instead of "the database says so."

---

## 2. Accounting Engine (The Boring Stuff Done Right)

### Atomic, Idempotent, Safe Posting
- `commitJournalAtomic` — the single source of truth for every journal mutation.
  - Validates debits = credits (with proper FX handling).
  - Enforces closed accounting periods (`assertAccountingPeriodOpen`).
  - Uses advisory locks per branch for safe concurrency.
  - Full Git ancestry linking + Event creation in one transaction.
  - Idempotency keys prevent duplicate work.

- Credit notes / cancellations create proper reversing journals via the same atomic path and link via `Invoice.reversedJournalEntryId`.

### Periods, Closing & Controls
- Real accounting periods (`AccountingPeriod`) with `OPEN` / `CLOSED` status.
- Closed-period enforcement on every atomic commit.
- Admin UI for create / close / reopen with audit notes.

### Foreign Currency Done Properly
- Provisional vs authoritative FX sources (`lib/fxSources.ts`).
- `calculateFxBalance` + mandatory sourced rates for non-base amounts.
- Bank-feed and statement lines get proper `BANK_FEED:...` / `statement:...` provenance.
- AI autonomous entries are forced to use provisional or explicit rates (never fake authoritative).

### Recurring & Automation
- Recurring journals and invoices with full scheduling.
- Autonomous generation via `createAutonomousJournal` + `generateRecurringJournalOccurrence`.
- High-confidence AI actions (see below).

### Expense Claims (Real Workflow)
- Full draft → submit → approve/reject/changes-requested lifecycle.
- Multi-line with receipts, tax, FX, payment method.
- Approvals, activities, and reimbursements tracked.
- Can post to the ledger only when approved and balanced.

---

## 3. The Git Model in Practice (Real Features)

| Feature                    | Implementation                                      | Marketing Angle |
|---------------------------|-----------------------------------------------------|-----------------|
| Visible history           | `getVisibleJournalEntryIds` + ancestry walking      | "See exactly what the books looked like on any date" |
| Branching                 | `AccountingBranch` + parentEventId                  | "Let the AI work without touching the real books" |
| Merge                     | `mergeBranch` (replays only new entries)            | "Accept AI work safely into main" |
| Diff                      | `diffPoints`                                        | "Show the exact net change between any two states" |
| Blame                     | `blameAccount`                                      | "Who (or what AI) touched this account and why" |
| Restore / Rollback        | `restore.ts` creates `ROLLBACK` commit              | "Time travel that is fully auditable" |
| Reconciliation            | `reconcile.ts` + autonomous clearing entries        | "AI proposes clearing entries at high confidence" |
| Events / Audit            | Full `Event` model + typed `EventType`              | "Complete tamper-evident history" |

---

## 4. AI That Actually Commits (Not Just Suggests)

- Full conversational AI (`app/api/chat/route.ts`) with tool calling.
- **High-confidence autonomous execution**: when chat lock is open and validation passes, the model can directly call `createAutonomousJournal`.
- Every autonomous entry is tagged `AI_AUTONOMOUS_ENTRY` with model, confidence, reasoning, and sources.
- PDF attachments are uploaded via the provider's Files API (xAI) when appropriate.
- Persistent, user-owned chat threads (`lib/chatThreadStore.ts`) with bounded context and idempotency.
- Skills system for structured behavior (`lib/skills.ts` + `.grok/skills/`).
- Strong safety rails: master-data actions, destructive actions, and low-confidence items are always proposals only.

**Result:** The AI behaves like a very good junior accountant who is allowed to post when you're confident in it.

---

## 5. Security & Compliance (Production-Ready)

### Authentication & Access
- Email magic links + OAuth (Google, GitHub, Microsoft Entra ID) with strict allow-listing.
- Invitation-only user creation with single-use, expiring tokens.
- Real **RFC 6238 TOTP** (time-based one-time passwords) with:
  - Encrypted storage of secrets.
  - One-time recovery codes (hashed).
  - Mandatory admin setup in production.
  - TOTP session proofs + re-auth requirement to disable.
- User disablement with immediate session revocation (`disabled` flag + `sessionVersion`).
- Role-based access (`ADMIN` / `ACCOUNTANT` / `VIEWER`) enforced on every route.

### Hardening
- Database-backed rate limiting on auth, TOTP, admin, jobs, health, etc.
- Strict Content-Security-Policy with per-request nonces + `strict-dynamic`.
- Private file authorization (`lib/fileAccess.ts` + `canAccessFileAsset`).
- Structured logging with automatic secret/PII redaction (`lib/logger.ts`).
- Correlation IDs (`x-request-id`) on every request/response/error path.
- Production secret validation at startup (`lib/env.ts`).

### Data Protection
- `ENCRYPTION_KEY` (AES-256-GCM) for bank credentials and future secrets.
- Documented, safe encryption key rotation procedure.
- All financial documents and sensitive values are prevented from entering logs.

---

## 6. Reliability, Durability & Operations

### Backups (v4)
- Complete portable encrypted backup: every table + all receipt files.
- Cryptographic integrity (SHA-256 per file + manifest).
- Encryption key fingerprint check on restore.
- Full round-trip restore is proven (including files + Git pointers).

### Durable Jobs & Webhooks
- Database-backed outbox/jobs with:
  - Idempotency keys
  - Leasing + stale lock recovery
  - Exponential backoff retries
  - Dead-letter state
  - Full attempt history
- Stripe & PayPal webhooks:
  - Signature verification
  - Idempotent `WebhookEvent` + `FeedTransaction` upserts
  - All processing happens asynchronously via durable jobs
  - Admin-visible retry UI

### Self-Hosted Updates
- Admin-triggered, digest-pinned image updates.
- Automatic pre-update backup.
- Post-restart health gate before marking success.
- Automatic rollback on failure.

### Observability
- `/api/health` reports DB, storage, webhook config, job queue (pending + dead-letter), missing secrets, and `requestId`.
- Structured logs with correlation IDs everywhere.
- Rich audit log surface (Events).

---

## 7. Integrations That Actually Work

- **Payments**: Stripe + PayPal invoice/payment links + status tracking.
- **Webhooks**: Replay-safe, async, durable processing for both providers.
- **Bank Feeds**: Normalized transaction model; supports Stripe Balance Transactions and manual import.
- **Email**: SMTP or Resend for invoice delivery + user invitations.
- **PDF Invoices**: Professional layout with company logo, IBAN QR code, multi-language support.
- **Attachments**: Secure private storage with proper authorization.

---

## 8. Reporting & Day-to-Day Power Features

- Balance Sheet, Profit & Loss, Cash Flow — all Git-aware and point-in-time.
- CSV export.
- Full audit log with rich payload.
- Reconciliation reports with autonomous clearing option.
- Recurring invoices & journals.
- Expense claims with receipts and reimbursement tracking.
- Real multi-currency with proper FX provenance.

---

## 9. Developer & Extensibility Notes

- Skills system for controlled AI behavior.
- Pluggable LLM providers (OpenAI, xAI, Anthropic, etc.).
- Comprehensive automated test coverage for accounting invariants, backup/restore, auth guards, TOTP, file access, etc.
- Correlation IDs + request tracing from edge to database.
- Clean separation between autonomous high-confidence paths and proposal/review paths.

---

## 10. What This Means for Customers

- **Trust**: Real immutable history + Git-style controls instead of "trust the last state of the database".
- **Speed**: High-confidence AI does the repetitive work; humans direct and review.
- **Safety**: Closed periods, atomic commits, encryption, TOTP, rate limits, private files.
- **Resilience**: Proven backups, durable jobs, webhook replay protection, safe self-updates.
- **Independence**: Fully self-hosted. You own your data and your server.

---

**Bottom line for marketing copy:**

"entrytwo is the accounting system that finally treats financial records with the same rigor as source code — immutable history, branches, merges, blame, and an AI that can safely commit when you let it."

Use the concrete names and capabilities above when talking to technical buyers, auditors, or sophisticated prospects. They will recognize that this is not another CRUD ledger with an AI chatbot bolted on.

---

*Document generated from actual codebase inspection (2026-07). All referenced functions, tables, and behaviors exist in the current implementation.*
