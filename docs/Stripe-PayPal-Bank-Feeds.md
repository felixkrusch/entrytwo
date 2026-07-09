# Stripe & PayPal Bank Feeds — Deep Design & Implementation Plan

**Project:** entrytwo  
**Status:** Detailed Design + Phased Implementation Plan (pre-implementation)  
**Date:** 2026-07-09 (updated 2026-07-09)  
**Priority:** High for processor data, but secondary in overall coverage to statement uploads  
**Scope:** Make **structured** Stripe and PayPal feeds (APIs + webhooks) *actually reliable*. This is the processor-specific track only.

**Related documents:**
- `Statement-Uploads-BANK_FEED-Sources.md` — PDF statements and pasted HTML tables (primary path for credit cards, Visa/Mastercard statements, and most banks)
- `Stripe-PayPal-Implementation-Plan.md` — concrete checklist for this track

We deliberately **do not** pursue broad live bank-by-bank integrations. The winning combination is:
- Statement uploads (PDF + copy-paste HTML tables from bank websites) for general banks and credit cards
- Reliable structured processing only for the two biggest processors (Stripe + PayPal)

---

## 1. Executive Summary

Stripe and PayPal are high-volume sources for many businesses. When done right, they can provide:

- Authoritative FX rates (marked as `BANK_FEED:stripe:...` or `BANK_FEED:paypal:...`)
- Clean, auditable journal entries via the existing Git model
- Automatic matching to invoices and contacts
- Proper handling of fees, refunds, disputes, payouts, and multi-currency

When done wrong (as in many legacy systems), they create:

- Timing mismatches (authorization vs capture vs payout)
- Duplicate or missing entries
- Lost fees
- Broken FX
- Reconciliation nightmares

**Goal:** Nail these two processors so thoroughly that users never have to manually correct processor-derived entries again.

This document defines the deep requirements, the problems to avoid, the correct data flow, and a concrete phased implementation plan.

---

## 2. Why This Is Hard (Real-World Pain Points)

From years of complaints about Xero, QuickBooks, etc.:

- **Payouts are the real bank movement** — Charges appear in the processor, but the money that actually hits the bank account comes later in a payout batch (often batched, net of fees, converted).
- **Fees are everywhere** — Platform fees, processing fees, cross-border fees, currency conversion fees. They must be booked explicitly.
- **Refunds and disputes create negative or reversing flows** at different times.
- **Multi-currency is treacherous** — Stripe has `balance_transaction` with `exchange_rate`. PayPal has separate conversion records.
- **Webhooks are lossy** — They can be delayed, retried, or missed. You need a reliable sync fallback.
- **Idempotency is mandatory** — The same `charge.succeeded` or payout can be processed multiple times.
- **"Pending" vs "available" balance** in Stripe is a frequent source of confusion.
- **One logical sale can generate many ledger events** across time.

entrytwo must treat processor feeds as **first-class authoritative sources** while still producing clean double-entry that respects the Git model.

---

## 3. Current State (as of 2026-07-09)

### Schema
- `BankConnection` (provider, externalId, encrypted credentials, linked Account)
- `FeedTransaction` (raw event, status, amount, currency, fxRateToBase, rawData JSON, optional link to JournalEntry)
- `fxSource` convention already uses `BANK_FEED:...` prefix for authoritative rates.

### Existing (Partial) Code
- Stripe sync (`/api/bank-feeds/sync`): Only pulls recent `/v1/charges`. Very narrow.
- PayPal sync: Hardcoded 2024 date range — effectively broken for ongoing use.
- Webhooks:
  - Stripe: Handles a few payment_intent events + creates very simplistic journal entries (only Cash ↔ AR, no fees, no FX, no proper payout handling).
  - PayPal: Handles `PAYMENT.*.COMPLETED` but only updates invoice status; later events fall back to crude FeedTransaction creation.
- No proper use of Stripe **Balance Transactions** or **Payouts** APIs.
- No dispute/chargeback handling.
- No fee lines.
- No separation between "processor view" and "bank settlement view".
- Reconciliation engine is still naive.
- Chat/PDF FX lookup (`lib/feedMatching.ts`) already prefers `BANK_FEED` lines — good foundation.

**Verdict:** The scaffolding and philosophy are correct. The actual processor integration is incomplete and fragile.

---

## 4. Core Design Principles (Non-Negotiable)

These must be followed exactly, consistent with the rest of entrytwo:

1. **Git Model Always Applies**
   - Every journal entry derived from a feed must create a proper `Event` (usually `JOURNAL_ENTRY_CREATED` or a specific feed-related type if we add one).
   - The event must be parented to the current branch head.
   - `introducedByEventId` must be set.
   - `recordCommitOnBranch` must be called.
   - Restore/merge semantics must continue to work.

2. **Authoritative FX from Feeds**
   - Any line that comes from a Stripe or PayPal feed must set:
     - `fxSource` starting with `BANK_FEED:stripe:` or `BANK_FEED:paypal:`
     - `fxRateToBase` (when currency differs from base)
     - `fxDate`
   - These rates must win over ECB and manual rates in all downstream logic (chat, reports, PDF processing).

3. **Preserve Raw Data**
   - Every `FeedTransaction` must store the full original payload in `rawData`.
   - This enables re-processing, audits, and future improvements without data loss.

4. **Status Lifecycle**
   - `pending` → `matched` → `posted` (or `ignored`)
   - Never silently overwrite. Matching and posting must be explicit.

5. **Double-Entry Correctness**
   - Fees must be booked to a proper expense (or contra-revenue) account.
   - Payouts that net fees must be recorded as such.
   - Refunds and disputes must produce proper reversing or adjusting entries.
   - Net amounts must be explainable in the classical reconciliation report.

6. **Chat Lock & Safety**
   - High-confidence autonomous posting only when chat is unlocked.
   - Otherwise, create clean proposals that the user can review/confirm.

7. **Idempotency**
   - Use `externalId` + `connectionId` uniqueness.
   - Webhook handlers and sync must be safe to run multiple times.

8. **Processor vs Bank Separation**
   - A charge in Stripe is **not** the same as money hitting the bank.
   - Payouts (Stripe) / Mass Payouts (PayPal) are usually the events that should create the "bank movement" side of the entry.
   - We need clear mental models and UI language for this.

---

## 5. Recommended Data & Event Coverage

### Stripe — Authoritative Sources

Use these in priority order:

1. **Balance Transactions** (`/v1/balance_transactions`)
   - The single best source for "what actually happened to my balance".
   - Includes charges, refunds, adjustments, fees, payouts, transfers.
   - Has `exchange_rate`, `fee`, `net`, `currency`, `reporting_category`.
   - This should be the primary sync source.

2. **Payouts** (`/v1/payouts`)
   - When money is sent to the bank account.
   - Contains `amount`, `currency`, `arrival_date`, `balance_transaction`.
   - Critical for knowing when the bank actually receives funds.

3. **Charges + Refunds + Disputes**
   - For richer descriptions, customer info, and dispute lifecycle.

4. **Webhooks**
   - `charge.succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid`, `payout.failed`, `balance.available`, etc.
   - Webhooks should be the *fast path*. Sync is the reliable backfill.

### PayPal — Authoritative Sources

PayPal's APIs are more fragmented:

1. **Transactions API** (`/v1/reporting/transactions`) — better than before but still not perfect for real-time.
2. **Checkout Orders + Payments** (`/v2/checkout/orders`, `/v1/payments`)
3. **Payouts API** (`/v1/payments/payouts`)
4. **Disputes API**
5. **Webhooks** (strongly preferred):
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `PAYMENT.CAPTURE.DENIED`
   - `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`
   - `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`
   - `BILLING.SUBSCRIPTION.*` (if we support recurring later)

PayPal also has currency conversion records that must be captured for correct FX.

---

## 6. Proposed Normal Form for Processor Transactions

We should normalize incoming data into a consistent internal shape before creating `FeedTransaction` records. Suggested common fields (stored in `rawData` + top-level columns):

- `processor`: 'stripe' | 'paypal'
- `eventType` / `reportingCategory`
- `externalId` (unique per connection)
- `occurredAt`
- `amount`, `currency`
- `feeAmount`, `feeCurrency`
- `netAmount`, `netCurrency`
- `exchangeRateToBase` (if provided by processor)
- `type`: 'charge' | 'refund' | 'payout' | 'fee' | 'dispute' | 'adjustment' | ...
- `direction`: 'in' | 'out'
- `linkedInvoiceId` (if we can resolve)
- `linkedContactId`
- `payoutId` (for grouping charges that settled together)
- `raw`

This normalization layer makes the rest of the system (matching, journal creation, reconciliation) processor-agnostic.

---

## 7. Journal Entry Patterns (What Good Looks Like)

### Simple Charge (same currency as base)
```
Dr 1000 Cash / Bank (or Processor Clearing)   100
Cr 4000 Revenue                               100
Cr 5200 Payment Processing Fees                 3   ← fee line
```

### Charge with FX (Stripe gave us the rate)
```
Dr 1010 Bank (EUR)                            920
Dr 5200 FX / Fees                               5
Cr 1100 Accounts Receivable (USD)            1000   (with fxRateToBase from feed)
```

### Payout Received in Bank
```
Dr 1010 Bank Account                         885
Cr 1000 Stripe/PayPal Clearing               885
```

### Refund
```
Dr 4000 Revenue (or contra)                  -xx
Dr 5200 Fees (if fees are refunded)          -yy
Cr 1000 Cash / Processor Clearing
```

### Dispute / Chargeback
More complex — usually two phases (created, then won/lost). Must be able to represent both.

All of the above must:
- Use correct `currency` + `fxRateToBase` + `fxSource: BANK_FEED:...`
- Create proper Events
- Be visible in ancestry
- Appear correctly in P&L, Balance Sheet, and reconciliation reports

---

## 8. Matching Strategy

1. **Invoice linking**
   - Prefer `metadata.invoiceId` (Stripe) or `custom_id` / `invoice_number` (PayPal)
   - Fall back to amount + date + contact fuzzy match

2. **Contact resolution**
   - Use existing `contacts/lookup-or-create` logic

3. **Automatic vs manual**
   - High-confidence matches (exact invoice link + amount) can be auto-matched.
   - Everything else starts as `pending` and is proposed to the user (or chat).

4. **Payout batching**
   - Many charges settle in one payout. The system should be able to group them and create a clean "Payout received" entry while keeping the individual charge detail available.

---

## 9. Reconciliation & Reporting

- Processor feeds must be first-class inputs to the reconciliation engine.
- The classical reconciliation report must show:
  - Processor balance at start
  - Charges, refunds, fees, payouts
  - What has been posted to the ledger
  - Outstanding items
  - Net movement that should match bank

- FX rates from these feeds must be used in reports when available.

---

## 10. Security, Credentials & Webhooks

Current state:
- Encryption via `lib/encryption.ts` (good)
- Stripe signature verification exists but is used inconsistently
- PayPal signature verification is mostly placeholder

Required improvements:
- Always verify signatures in production (fail closed).
- Support webhook secret rotation.
- Store minimal scopes (Stripe: read-only balance + payouts + webhooks).
- Document exact required permissions for each processor.
- Rate-limit webhook endpoints.
- Log all webhook processing with correlation IDs for debugging.

---

## 11. Implementation Plan (Phased)

### Phase 0 — Foundations (no user-facing changes yet)
- Create this document (done).
- Define the normalized processor transaction shape (internal type + tests).
- Improve `lib/webhook.ts` with proper, strict signature verification helpers.
- Add a small set of unit tests for idempotency and duplicate prevention.

### Phase 1 — Stripe Reliability (highest impact)
1. Switch primary sync source to **Balance Transactions**.
2. Add full **Payouts** sync.
3. Expand webhook handler to cover:
   - `charge.*`
   - `refund.*`
   - `dispute.*`
   - `payout.*`
   - `balance.available`
4. Create proper journal entries:
   - Separate fee lines
   - Correct FX using balance_transaction data
   - Link to invoices when metadata present
5. Implement payout batch grouping logic (optional but valuable).
6. Backfill logic: given a connection, re-process historical balance transactions safely.
7. UI: Show "Stripe" transactions with better labels ("Charge", "Payout to Bank", "Fee", "Refund").

### Phase 2 — PayPal Reliability
1. Replace the broken sync with proper recent transactions + payouts.
2. Expand webhook coverage (see list in §5).
3. Capture currency conversion records for FX.
4. Same journal entry quality as Stripe (fees, net amounts, FX, links).
5. Handle PayPal "Mass Payouts" and "Payouts" distinctly.

### Phase 3 — Unified Processor Layer
- Introduce a clean `ProcessorFeedProvider` interface (or similar).
- Move normalization, matching hints, and journal creation patterns behind it.
- Make adding future processors (or aggregators) much cheaper.
- Update the "Quick Feed Import" and bank-feeds UI to be processor-aware.

### Phase 4 — Reconciliation & Polish
- Deep integration with the Git-model reconciliation engine.
- Proper "Processor Reconciliation" view (separate from or alongside bank account reconciliation).
- Authoritative rate usage in reports and chat becomes rock-solid.
- Better duplicate detection and "ignore this forever" UX.

### Phase 5 — Testing & Hardening
- Comprehensive sandbox + real-account test matrix.
- Idempotency stress tests (replay same webhook 10×).
- Timing tests (charge today, payout in 3 days).
- Dispute lifecycle tests.
- FX accuracy tests across currencies.
- Performance: handle thousands of historical transactions on first sync.

---

## 12. Testing Strategy (Critical)

- **Deterministic replay**: Store raw events and be able to re-process them in tests.
- **Sandbox + Live parity**: Assume they differ in subtle ways.
- **Time travel**: Be able to simulate "charge on day 1, payout on day 4".
- **Failure injection**: Webhook delivery fails, sync returns partial pages, rate limits.
- **Golden reconciliation reports**: For known sets of processor events, assert the exact journal entries + report output.

---

## 13. Migration & Backwards Compatibility

- Existing `FeedTransaction` and `BankConnection` records must continue to work.
- Old simplistic journal entries created by the current Stripe/PayPal code should be treated as "legacy" but never deleted.
- When re-syncing a connection, detect already-processed `externalId`s and skip or offer "reconcile differences".
- Provide a one-time "Reprocess Stripe/PayPal history" admin action (carefully gated).

---

## 14. User Experience Goals

- When a user connects Stripe or PayPal, the first sync should feel magical but safe.
- They should see clear categories: "Charges", "Payouts to Bank", "Fees", "Refunds", "Disputes".
- High-confidence items can be auto-posted (when unlocked) or proposed cleanly.
- The system should tell them "This payout of €885 corresponds to 12 charges minus €27 fees".
- FX rates from these feeds should just "work" in PDF chat and reports without user intervention.

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|----------|
| Webhook signature verification fails in prod | Strict fail-closed + good dev-mode bypass documented |
| Payouts and charges get double-booked | Strong externalId + connectionId uniqueness + payout batch awareness |
| FX from processor is wrong | Always prefer processor-provided rate when present; store source clearly |
| Users expect "one entry per charge" | Educate via UI + offer "simple mode" vs "detailed mode" later |
| PayPal API changes | Keep raw data; make normalization defensive |
| Large historical sync is slow | Paginate properly, use incremental sync, show progress |

---

## 16. Success Criteria

Before we consider this "done":

- A fresh Stripe connection can sync 6 months of history and produce correct, balanced journal entries including fees and payouts.
- Same for PayPal.
- Webhooks arriving in real time update the feed and (when appropriate) create or update entries without duplicates.
- FX rates from processor feeds are used authoritatively everywhere.
- Reconciliation report for a processor account is useful and auditor-friendly.
- User reports significantly less manual correction work than in Xero or similar tools.

---

## 17. Relationship to Broader Bank Feeds Roadmap (Updated)

We have narrowed focus. The new priority order (as of 2026-07-09) is:

1. **Statement uploads (PDF + HTML copy-paste from bank portals)** — especially credit card statements (Visa, Mastercard, etc.).  
   See: `Statement-Uploads-BANK_FEED-Sources.md`  
   This gives worldwide coverage with almost zero per-bank maintenance. The LLM extracts structure from messy documents and pastes. All extracted rates are marked `BANK_FEED:statement:...`.

2. **Stripe + PayPal structured feeds (this document)** — reliable API + webhook processing for the two highest-volume processors.  
   These are "live/structured" sources, not document uploads.

3. Structured file imports (CAMT.053, OFX, clean CSV) — future work that can reuse statement normalization.

4. One good US aggregator (Plaid) and/or one European (Salt Edge/Tink) — only if high-volume users specifically demand always-on live feeds. Not a priority for general bank coverage.

We are **not** doing per-bank live integrations or broad Open Banking work.

Statement uploads and reliable Stripe/PayPal processing together solve the vast majority of the "broken in Xero" credit card and processor pain.

---

## 18. Open Questions (to resolve before heavy implementation)

- Should we introduce a dedicated `ProcessorTransaction` model, or is `FeedTransaction` + rich `rawData` sufficient?
- How do we represent "clearing" accounts for processors (e.g. "Stripe Clearing") vs actual bank accounts?
- Do we want a "simple" vs "detailed" posting mode for users who don't care about per-charge fees?
- What is the exact set of required Stripe scopes / PayPal permissions we will document?

---

**This document is the single source of truth for Stripe & PayPal feed work until superseded.**

We will start implementation only after review and agreement on the phases and non-negotiables above.
