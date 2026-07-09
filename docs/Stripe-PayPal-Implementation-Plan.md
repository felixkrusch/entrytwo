# Stripe & PayPal Bank Feeds — Implementation Plan

**Related Design Doc:** `docs/Stripe-PayPal-Bank-Feeds.md` (read first)  
**Status:** Pre-implementation checklist  
**Date:** 2026-07-09 (updated 2026-07-09)  
**Goal:** Make **structured** Stripe and PayPal feeds (APIs + webhooks) reliable, authoritative, and Git-model compliant.

**Scope note:** This document covers only the *live/structured processor* track (Stripe and PayPal APIs + webhooks).

**Primary mechanism for credit cards and most banks:**  
Statement uploads (PDF files + copy-paste of HTML tables directly from the bank's website into chat).  
The LLM extracts structure extremely well from messy PDFs and HTML tables.  
See: `docs/Statement-Uploads-BANK_FEED-Sources.md`

We are **not** building broad live bank feeds or per-bank integrations. The strategy is:
- Statement uploads (PDF + pasted HTML) as the general solution
- High-quality structured processing only for Stripe and PayPal

This combination directly addresses the worst "credit card feed" breakage users see in Xero and similar tools.

---

## Guiding Principles (Never Compromise)

- Every feed-derived journal entry goes through the Git model (Events + `recordCommitOnBranch`).
- Feed-sourced FX is always marked `BANK_FEED:stripe:...` or `BANK_FEED:paypal:...` and wins over other sources.
- Idempotency on `connectionId` + `externalId`.
- Preserve full `rawData`.
- Webhooks are the fast path; sync is the reliable backfill.
- Never create unbalanced or incomplete entries (fees, FX, net amounts must be explicit).

---

## High-Level Phases

| Phase | Focus | Exit Criteria | Owner | Target |
|-------|-------|---------------|-------|--------|
| 0 | Foundations & Hardening | Signature helpers strict, normalization types, basic tests | — | 1-2 days |
| 1 | Stripe Reliability | Balance Transactions + Payouts as primary, rich webhooks, correct journal entries | — | 1-2 weeks |
| 2 | PayPal Reliability | Proper transactions + payouts + webhooks, FX conversions captured | — | 1-2 weeks |
| 3 | Unified Layer | Processor abstraction, shared matching/journal logic | — | 3-5 days |
| 4 | Reconciliation | Deep integration with Git reconciliation + reports | — | 1 week |
| 5 | Hardening & Validation | Sandbox + live test matrix, golden reports, performance | — | 1 week |

---

## Phase 0 — Foundations (Do This First)

**Goal:** Make future work safe and testable.

- [ ] Review and agree on `docs/Stripe-PayPal-Bank-Feeds.md`
- [ ] Define internal normalized shape (TypeScript interface)
  - Suggested fields: processor, externalId, occurredAt, amount, currency, feeAmount, netAmount, exchangeRateToBase, type, direction, payoutId, linkedInvoiceId, raw
- [ ] Add strict webhook signature verification helpers in `lib/webhook.ts`
  - Stripe: always verify when secret present, fail closed
  - PayPal: implement cert validation or clearly document dev bypass
- [ ] Add or update tests:
  - Idempotency (same externalId twice → no duplicate FeedTransaction)
  - Signature verification positive + negative cases
- [ ] Decide on "Processor Clearing" accounts strategy (create on first use? require user to pick? document decision)
- [ ] Document required API scopes/permissions for Stripe and PayPal in the design doc

**Exit Criteria**
- No more "trust the webhook in dev" without clear comments.
- A small set of unit tests that would have caught the current duplicate/naive bugs.

---

## Phase 1 — Stripe (Highest Leverage)

**Primary Data Sources (in order)**
1. Balance Transactions (`/v1/balance_transactions`)
2. Payouts (`/v1/payouts`)
3. Charges, Refunds, Disputes (for context)

**Webhook Events to Handle**
- `charge.succeeded`, `charge.failed`, `charge.refunded`
- `refund.*`
- `dispute.created`, `dispute.closed`, `dispute.funds_reinstated`, `dispute.funds_withdrawn`
- `payout.paid`, `payout.failed`, `payout.canceled`
- `balance.available`

**Tasks**
- [ ] Rewrite `syncStripe` to use Balance Transactions as the main loop
- [ ] Add full Payouts sync (including `arrival_date`)
- [ ] Expand webhook handler (`app/api/webhooks/stripe/route.ts`) to cover the list above
- [ ] Build journal entry creation logic that:
  - Creates explicit fee lines
  - Uses processor-provided FX when present
  - Marks `fxSource: BANK_FEED:stripe:<id>`
  - Links to invoice when metadata present
  - Creates proper Git Events and advances branch head
- [ ] Handle payout batching (group charges that settled in one payout)
- [ ] Add "Re-sync history" action for a Stripe connection (idempotent)
- [ ] Improve `FeedTransaction` creation to use the normalized shape
- [ ] UI labels in feed views: "Charge", "Payout to Bank", "Application Fee", "Refund", "Dispute Lost", etc.
- [ ] Update `createPaymentJournalEntry` (or replace it) with the new richer patterns

**Validation**
- [ ] Charge today → correct revenue + fee lines
- [ ] Multi-currency charge with processor rate → correct FX on lines
- [ ] Payout arrives 2 days later → clean bank movement entry
- [ ] Refund → proper reversing lines
- [ ] Replay same webhook 5× → no duplicate entries

**Exit Criteria**
- A brand-new Stripe connection + 3 months history produces clean, balanced books.
- Webhooks in real time keep the feed up to date without manual sync.

---

## Phase 2 — PayPal

**Primary Data Sources**
- Reporting Transactions API (for history)
- Payouts API
- Webhooks (primary for live)

**Key Webhook Events**
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.DENIED`
- `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`
- `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.FAILED`
- `BILLING.SUBSCRIPTION.*` (later)

**Tasks**
- [ ] Replace the broken syncPayPal (remove hardcoded dates)
- [ ] Use proper date ranges + pagination
- [ ] Capture PayPal currency conversion records for FX
- [ ] Expand webhook handler to all relevant events above
- [ ] Same journal entry quality as Stripe target (fees, net, FX, links, Git events)
- [ ] Distinguish "Checkout" payments vs "Payouts" (Mass Pay)
- [ ] Add re-sync history action

**Validation**
- Same scenarios as Stripe + PayPal-specific FX conversion cases

**Exit Criteria**
- PayPal behaves at the same reliability level as the completed Stripe work.

---

## Phase 3 — Unified Processor Abstraction

**Goal:** Don't repeat the same logic for the next processor or aggregator.

- [ ] Introduce a small internal abstraction (e.g. `ProcessorFeedAdapter` or similar)
  - Methods: `sync(connection, since?)`, `handleWebhook(event)`, `normalize(raw) → NormalizedTx`
- [ ] Move shared journal creation patterns behind it (or into a `lib/processors/createJournalFromFeed.ts`)
- [ ] Share matching hints (invoice link, contact resolution)
- [ ] Update admin / connections UI to be processor-agnostic where possible

**Exit Criteria**
- Adding a future processor (or Plaid) touches far less code.

---

## Phase 4 — Reconciliation & Reporting

- [ ] Extend `lib/accounting/reconcile.ts` and reconciliation report to understand processor feeds
- [ ] Add a "Processor Reconciliation" surface (can be part of existing feed transaction list + reports)
- [ ] Ensure processor-sourced FX rates are used in P&L / Balance Sheet when viewing the relevant period
- [ ] Make the classical report show processor vs bank settlement clearly

**Exit Criteria**
- Running reconciliation on a Stripe or PayPal connection produces an auditor-useful report.

---

## Phase 5 — Hardening, Testing, Polish

**Test Matrix (minimum)**
- [ ] Sandbox + live account parity checks
- [ ] Idempotency (webhook replay, sync replay)
- [ ] Timing (charge day 0, payout day +3)
- [ ] Dispute lifecycle (created → lost → funds withdrawn)
- [ ] Multi-currency + conversion fees
- [ ] Large history (1000+ transactions on first sync)
- [ ] Failure modes (rate limits, partial pages, missing webhooks)

**Golden Tests**
- [ ] Create "golden" sets of raw events → expected journal entries + balance impact
- [ ] Assert in tests that re-processing produces identical results

**UI / UX**
- [ ] Clear status in feed list (pending / matched / posted / ignored)
- [ ] "Post to books" or "Create proposal" actions from feed transactions
- [ ] Link from feed transaction to resulting journal entry (and vice versa)
- [ ] Good empty states and error messages for connection/sync problems

**Docs**
- [ ] Update `docs/SETUP.md` with required Stripe/PayPal credentials and webhook setup
- [ ] Add a short "Stripe & PayPal Feeds" section in user-facing docs (when ready)

**Exit Criteria**
- We can point a new user at "connect Stripe/PayPal" and they get reliable results with minimal manual work.

---

## Backwards Compatibility & Migration

- [ ] Existing `FeedTransaction` and `BankConnection` records remain valid
- [ ] Old simplistic journal entries are left as-is (legacy)
- [ ] Provide a one-time "Reprocess processor history" admin tool (gated)
- [ ] Document the change in behavior for existing users

---

## Risks & Checkpoints

| Checkpoint | Question to Answer |
|------------|--------------------|
| After Phase 0 | Do we have strict verification + clear normalized shape? |
| After Phase 1 Stripe | Can we take a fresh account + history and get correct books? |
| After Phase 2 PayPal | Same quality bar as Stripe? |
| Before Phase 4 | Is the abstraction clean enough that reconciliation work isn't duplicated? |
| Before shipping | Do we have golden tests + timing/dispute coverage? |

---

## Definition of Done (Stripe + PayPal)

1. Fresh connection + historical sync produces balanced, explainable double-entry.
2. Live webhooks keep the system current without duplicates.
3. Processor-provided FX rates are used authoritatively.
4. Fees, refunds, payouts, and disputes are all represented explicitly.
5. Git model invariants are respected for every derived entry.
6. Reconciliation report for the processor is useful.
7. User manual correction effort is dramatically lower than in Xero-style systems.

---

## Open Decisions (Resolve Before or During Phase 0)

- Processor "clearing" account strategy
- Simple vs detailed posting mode (future?)
- Exact required Stripe scopes / PayPal permissions list
- Whether to add a dedicated `ProcessorTransaction` model or stay with rich `FeedTransaction`

---

**Use this plan as the working checklist.**  
Update status here as work progresses. Keep the deep design in `Stripe-PayPal-Bank-Feeds.md` as the "why".
