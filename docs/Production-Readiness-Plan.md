# Production Readiness Plan

## Production Target

The first production target is a self-hosted, single-company accounting application with multiple users, AI-first document interpretation, private financial records, reliable backups, and Stripe and PayPal integrations.

One company equals one deployment and one database. Multi-tenancy is out of scope until tenant isolation is designed across every financial model, query, file, cache entry, webhook, and job.

## Implementation Progress

Completed:

- Unsupported Plaid, Salt Edge, scheduled synchronization, placeholder VAT validation, and heuristic invoice extraction removed
- Deny-by-default API proxy and method-aware role policy registry
- Local authentication guards on every non-public API route
- Viewer, accountant, and administrator mutation boundaries
- Admin-only processor feeds, backups, settings mutations, user management, and destructive restore
- Concurrency-safe bootstrap and last-administrator protection
- Database-backed OAuth users with new users defaulting to `VIEWER`
- RFC 6238 TOTP with encrypted secrets, mandatory production administrator setup, replay protection, and one-time recovery codes
- Canonical atomic accounting commit service for manual, AI, processor, claim, invoice, recurring, reversal, feed-import, matching, and merge postings
- Concurrency-safe journal numbering and branch-head advancement
- Accounting idempotency keys for external, recurring, chat, claim, invoice, and reversal postings
- Transaction rollback and concurrent ancestry-chain tests
- Unified private `FileAsset` storage for chat uploads, journals, claims, and document library
- Authenticated, resource-authorized file delivery with no public upload directory
- Development and test databases reset after the private-storage cutover; existing documents intentionally discarded
- Persistent PostgreSQL chat threads and messages with user ownership, bounded context, attachment links, and idempotent appends

Remaining in Milestone 1:

- Final OAuth provider/account-linking policy and invitation workflow
- Shared/distributed authentication rate limiting
- Security-event audit records and session invalidation after role or account changes

## Architectural Boundaries

### AI responsibilities

The LLM and skills are authoritative for:

- Document classification and interpretation
- Invoice and receipt extraction
- Bank-statement interpretation
- Tax interpretation
- Account suggestions
- Claim-line construction
- Identifying uncertainty and asking for clarification
- Producing business actions

There is no parallel deterministic or heuristic extraction pipeline.

### Application responsibilities

The application is authoritative for:

- Authentication and authorization
- Workflow state transitions
- Database referential integrity
- Idempotency and concurrency
- Transactional writes
- Balanced accounting commits
- Closed-period enforcement
- File access control
- Audit history
- Backup and restore
- Webhook verification

Strict schemas must not duplicate or constrain AI interpretation. AI action handling should be permissive and skill-led. Hard security, workflow, database, and ledger invariants remain non-negotiable.

## Milestone 1: Secure Surface

### Remove unsupported integrations

Remove all Plaid and Salt Edge functionality:

- Setup and webhook routes
- Mock token exchange logic
- Provider-specific UI and copy
- Environment and setup documentation
- Provider branches and tests

Remove scheduled bank synchronization:

- Cron feed-sync route
- Cron configuration
- Placeholder polling behavior
- UI that implies scheduled synchronization is supported

Retain Stripe, PayPal, CSV/statement import, generic feed transactions, matching, and reconciliation.

### Remove redundant extraction paths

- Remove placeholder invoice extraction routes and heuristic parsers.
- Keep skills as the only document interpretation mechanism.
- Keep separate skills for invoices, claims, statements, and journals.
- Preserve only permissive normalization plus hard domain invariants.

### Defer VAT validation

- Continue storing VAT numbers and displaying them on invoices.
- Do not claim that an unchecked number is verified.
- Remove placeholder validation behavior.
- Treat VIES validation as an optional future convenience.

### Deny-by-default API authorization

Public routes are limited to:

- Health checks
- Auth.js callbacks
- Initial bootstrap before the first administrator exists
- Cryptographically verified Stripe and PayPal webhooks

Every other route requires an explicit policy:

- Authenticated user
- Accountant or administrator
- Administrator only
- Resource owner

Authorization must exist in domain services as well as route handlers. Add an automated route inventory that fails when a route has no declared policy.

### Correct current-user identity

`/api/me` must report the authenticated user and their actual role. It must not report that the current user is an administrator merely because any administrator exists.

### Implement real TOTP

- Generate secrets with a cryptographically secure random source.
- Encrypt secrets before database storage.
- Keep setup pending until the first code is cryptographically verified.
- Implement RFC 6238 verification with limited clock skew.
- Rate-limit and audit verification failures.
- Require the second factor after magic-link or OAuth authentication.
- Mark sessions as fully verified only after TOTP succeeds.
- Add hashed, one-time recovery codes.
- Require reauthentication to disable or replace TOTP.
- Require TOTP for administrators in production.

### Complete OAuth

- Persist users through the database adapter regardless of SMTP configuration.
- Support only explicitly selected providers.
- Require verified provider email addresses.
- Never grant administrator access automatically.
- Require invitation or administrator approval for new OAuth users.
- Define safe account-linking behavior.
- Enforce TOTP after OAuth where enabled.
- Validate production callback URLs and cookie behavior.
- Invalidate sessions after role changes or account disablement.

### Disable development authentication in production

- Exclude or hard-disable the development sign-in route.
- Require `AUTH_SECRET` in production.
- Remove production fallback secrets.
- Restrict trusted hosts.

### Milestone 1 exit criteria

- Unsupported integrations are absent.
- Every API route has an explicit access policy.
- Private records cannot be accessed by changing an ID.
- `/api/me` returns the current user's role.
- Real TOTP is enforced during login.
- OAuth persistence and role assignment are correct.
- Development authentication is unavailable in production.

## Milestone 2: Trustworthy Books

### Canonical accounting commit service

Create one internal service that atomically:

- Locks or compares the branch head
- Allocates the entry number
- Creates the journal entry and lines
- Creates attachment associations
- Creates the event with its ancestry parent
- Links `introducedByEventId`
- Advances the branch head
- Stores an idempotency key

Migrate manual journals, AI journals, batches, reversals, claims, reimbursements, invoices, recurring entries, Stripe, PayPal, statement imports, merges, and reconciliation adjustments to this service.

### Concurrency and idempotency

- Never swallow accounting write failures.
- Detect branch-head conflicts and retry or reject safely.
- Allocate document numbers inside the transaction.
- Store unique idempotency keys for webhooks, recurring occurrences, chat commands, claims, invoices, and import rows.
- Add simultaneous-post and failure-injection tests.

### Ledger invariants

- Require at least two journal lines.
- Require total debit to equal total credit in base currency.
- Require a positive posting value.
- Require referenced accounts to exist.
- Require sufficient currency metadata.
- Prevent silent edits to posted facts.
- Require valid reversal links.

These are ledger invariants, not a second AI interpretation layer.

### Accounting periods

- Add fiscal periods and open/closed state.
- Reject ordinary posting into closed periods.
- Audit closing and reopening.
- Require a reason and authorized user to reopen a period.

### Milestone 2 exit criteria

- Every financial mutation uses the canonical commit service.
- Concurrent posting cannot corrupt branch history or numbering.
- Duplicate external events cannot duplicate journals.
- Failed transactions leave no partial financial records.
- Closed-period posting is blocked.

## Milestone 3: Durable Private Data

### Unified private file assets

Introduce one private file asset model for claims, journals, invoices, chat, and statements. Store opaque keys separately from original names and serve every file through an authenticated, resource-authorized endpoint.

Support private local storage first and an optional S3-compatible backend later. Stop writing financial files beneath `public/`.

Migrate existing public receipts, verify their hashes, update references, report missing files, and remove public access only after a successful migration.

### Complete backup and restore

Backups must include:

- A consistent PostgreSQL dump
- Every private file asset
- Users, roles, OAuth records, and encrypted TOTP data
- Agent memory and persistent chat
- Application, schema, and backup-format versions
- A hash manifest

Encrypt backups, support dry-run restore, validate compatibility and hashes, restore through staging, and run post-restore integrity checks.

Regularly restore a backup into an empty test environment and verify login, journal integrity, and file access. A backup is successful only when restore has been proven.

### Persistent user-owned chat

Replace the in-memory map with durable threads, messages, and attachment associations.

- Every thread belongs to a user.
- Thread IDs never grant access by themselves.
- Full history is persisted while model context remains bounded.
- Old context may be summarized without deleting the audit history.
- Add retention, deletion, and expired-thread cleanup.
- Record model and skill versions for AI actions.

### Skill hardening

- Keep extraction and semantic validation in skills.
- Version every skill.
- Record model provider, model, and skill version per action.
- Preserve assumptions and unresolved fields.
- Maintain representative receipt, invoice, claim, and statement fixtures.
- Evaluate skill changes before release.
- Keep action handling provider-independent and permissive.

### Milestone 3 exit criteria

- No financial document is public.
- All files survive backup and restore.
- Threads survive process restarts and enforce ownership.
- Skill and model versions are auditable.
- A clean disaster-recovery restore has succeeded.

## Milestone 4: Supported Integrations

### Stripe and PayPal only

- Verify webhook signatures against raw request bodies.
- Store external event IDs uniquely.
- Enforce timestamp and replay protection.
- Persist verified events before processing.
- Process events asynchronously and idempotently.
- Track processing state, retries, and errors.
- Support fees, refunds, disputes, partial payments, and currency conversion.
- Provide administrator visibility and manual retry for failed or unmatched events.

This recovery mechanism is not scheduled bank synchronization.

### Complete claims and invoicing

Claims:

- Correct recoverable and non-recoverable tax posting
- Personal funds, company card, and cash advance paths
- Partial reimbursement and payment matching
- Reversal and correction of posted claims
- Duplicate override reasons and audit

Invoicing:

- Skill-led invoice draft creation
- Concurrency-safe numbering
- Authorized PDF delivery
- Reliable email delivery state
- Stripe and PayPal payment matching
- Credit-note and correction behavior

### Milestone 4 exit criteria

- Duplicate webhook delivery produces no duplicate records.
- Failed processing is visible and retryable.
- Claims and invoices produce correct accounting records.
- No unsupported provider remains advertised or executable.

## Milestone 5: Production Operations

### Durable jobs

Use a database-backed outbox or durable job system for webhook processing, email, recurring generation, backups, cleanup, and long-running model work where necessary.

Jobs require idempotency, leases, timeouts, retries with backoff, attempt history, dead-letter state, and administrator retry controls.

### Security hardening

- Add and test a strict Content Security Policy.
- Review CSRF protection for cookie-authenticated mutations.
- Use shared rate limiting where multiple instances are supported.
- Fail startup when required secrets are missing.
- Document encryption-key rotation.
- Ensure sensitive values and financial documents never enter logs.

### Observability

- Structured logs with request and correlation IDs
- Error tracking
- Database, storage, webhook, job, backup, and LLM metrics
- Readiness checks for required dependencies
- Alerts for failed webhooks, stale backups, failed restore tests, and accounting conflicts
- Privileged-action audit events

### Release testing

Required automated coverage includes:

- API authorization matrix
- Magic-link, OAuth, TOTP, recovery, and session enforcement
- Accounting concurrency, rollback, reversal, and closed periods
- Private file authorization
- Backup corruption detection and clean restore
- Stripe and PayPal signatures, replay, retries, fees, and refunds
- Skill evaluations for multi-receipt claims, foreign currency, multi-page invoices, ambiguous data, and bank statements
- Browser flows for login, claims, invoices, payment, reports, protected files, and mobile layouts
- Migration tests from every supported release

## Go-Live Gates

Production release requires:

- No unauthenticated financial endpoints
- Real TOTP enforced for administrators
- Correct OAuth persistence and role assignment
- Atomic and idempotent accounting mutations
- No public financial documents
- Successful encrypted backup and clean restore
- Persistent, user-owned chat state
- Plaid, Salt Edge, and scheduled synchronization removed
- Replay-safe Stripe and PayPal processing
- Required secrets validated at startup
- Critical browser and migration tests passing
- Tested rollback and disaster-recovery procedures

Milestones 1 through 3 are mandatory before production use. Milestone 4 is mandatory before Stripe or PayPal is advertised as production-supported. Milestone 5 is mandatory before relying on the installation for unattended operations.
