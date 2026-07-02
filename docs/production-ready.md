# Production-Ready Checklist

**Last Updated:** 2026-07-01  
**Current Version Status:** Advanced MVP / Pre-Production (strong accounting + invoicing + feeds + AI chat + ledger view)

**Guiding Philosophy (Non-Negotiable — Read This First):**  
The definitive high-level document is **`docs/Git-Model-for-Accounting.md`**. 

This file is **foundational and must never be lost or contradicted**. It defines:

- The entire accounting system as a **Git repository of financial truth** (commits = journal entries, branches, merges, tags, diffs, blame, full history).
- AI as a **first-class autonomous contributor** that creates entries at high confidence.
- Reconciliation as an AI-first process whose output *is* the classical report.
- GitHub-style branching, merging, rollback, and time-travel as core features.
- The explicit goal: eliminate routine bookkeeping drudgery so users do not need to hire accountants for class-of-work that AI can handle reliably with proper logs and rollback.

**All implementation, AI behavior, UI, tests, and definitions of "production ready" are subordinate to this model.**

If any part of the system or any other document conflicts with `docs/Git-Model-for-Accounting.md`, the Git model document wins and the conflicting artifact must be updated.

---

## Executive Summary of Current State

entrytwo is a **chat-first, AI-native double-entry accounting system** with:

- Full double-entry journal with per-line tax (`taxRateId` + `taxIsInput`), multi-currency + authoritative `BANK_FEED` FX rates, and date-pinned conversion.
- Complete invoicing lifecycle (DRAFT → SENT → PAID, recurring that generates DRAFTs, PDF + EPC QR, Stripe/PayPal links, journal integration on create + payment).
- Bank/credit card feeds (Stripe + PayPal webhooks + API sync) with pending transactions, intelligent matching, merchant learning, and admin review/post flow.
- Dynamic right-panel views including the new `?view=ledger&accountCode=XXXX` system (high-reachability from chat, accounts, reports, P&L, audit).
- Solid audit trail via the `Event` table for all financial actions.
- Admin UI, company settings (incl. bank details), i18n, auth (magic link + TOTP), backup/export/import, health endpoint.

**It is functionally very advanced** for an internal / small-team tool and already handles real multi-currency + tax-aware accounting correctly.

**Guiding Principle:** The system must fully embody the Git Model for Accounting (see `docs/Git-Model-for-Accounting.md`). AI is expected to do the heavy lifting of reconciliation, explanations, and high-confidence autonomous entries. Full history, branching, rollback, and auditability are mandatory. "Human does the boring work" is not acceptable.

**It is not yet "100% production / audit / compliance ready"** for external use or regulated environments (see gaps below). The biggest missing pieces for the Git model vision are: real snapshot + replay infrastructure, accounting branches, chat-driven autonomous reconciliation + rollback, and treating classical reports as AI-produced artifacts.

---

## Completed / Strong Areas (as of 2026-07-01)

### Core Accounting
- ✅ Proper double-entry enforced on creation.
- ✅ Per-line tax with jurisdiction + type + input/output flag.
- ✅ Multi-currency on every JournalLine (currency + fxRateToBase + fxSource + fxDate). BANK_FEED rates are authoritative.
- ✅ Reports (Balance Sheet + P&L) are FX-aware + tax-aware with per-currency subtotals.
- ✅ Full audit via Event (JOURNAL_ENTRY_CREATED/REVERSED, INVOICE_*, etc.).
- ✅ Reversals, repeating entries, and templates supported.

### Invoicing (Production-Grade for Most Use Cases)
- ✅ Create = DRAFT + balanced revenue journal (AR + Revenue + output tax).
- ✅ Explicit mark as SENT; payments only move AR → Cash (no revenue double-counting).
- ✅ DELETE only allowed on DRAFT.
- ✅ PDF generation (pdfkit) with company branding + notes + QR.
- ✅ EPC QR (SEPA), Stripe/PayPal payment links.
- ✅ Snippets (text + line), recurring (DRAFT generation by default).
- ✅ Status lifecycle + aging visibility + journal link on invoice.
- ✅ ?view=invoicing with full list + creation form (chat can prefill).

### Bank Feeds & Matching
- ✅ Stripe + PayPal webhooks + API sync → FeedTransaction records.
- ✅ Matching engine (`lib/matching.ts` + merchant learning).
- ✅ Admin UI for pending transactions: review suggestion, Match & Post, or Ignore.
- ✅ Confidence scoring + learned preferences.
- ✅ Recent authoritative feed rates surfaced in chat/UI.

### UX & Reachability
- ✅ Left = Chat (fixed), Right = dynamic panels.
- ✅ New `?view=ledger&accountCode=XXXX` (plus filters from chat).
- ✅ High-reachability: click accounts / reports / P&L / audit events → opens ledger.
- ✅ Chat can open ledger with pre-filters ("how much did I spend on utilities in 2025").

### Platform & Ops
- ✅ Auth (NextAuth magic links + TOTP 2FA for ADMIN).
- ✅ Admin UI (users, company settings incl. bank/IBAN, tax rates).
- ✅ First-admin bootstrap gate.
- ✅ Backup export/import (selective).
- ✅ Health endpoint.
- ✅ Rate-limit lib exists (partially applied).
- ✅ i18n complete (next-intl, locale-aware formatting).

---

## Remaining Gaps for Full Production Readiness

### 1. Testing & CI/CD (Critical Blocker for Production)
- No automated tests (unit, integration, contract, or E2E).
- No GitHub Actions / CI pipeline (lint + typecheck + build + test + prisma validate on every push).
- No Playwright / Cypress for critical flows (create journal from chat, create+send invoice, match feed tx).

**Action:** Add vitest + test DB + basic contract tests + E2E smoke tests + CI.

### 2. Reconciliation (Classical Bank Reconciliation) — Must Follow Git Model
Per `docs/Git-Model-for-Accounting.md`:

Reconciliation is **AI-first**. The AI (via chat or agents) reconciles accounts, clears items, creates necessary adjustments at high confidence, and produces the classical reconciliation report as output.

There is no separate "manual reconciliation" vs "AI reconciliation". The report an auditor expects (starting balance, cleared, outstanding, adjustments, signed state) is exactly the artifact of a successful AI-driven reconciliation.

Current gaps:
- No snapshot + event replay foundation yet for reliable point-in-time views.
- No accounting "branches" for AI-proposed reconciliations.
- No chat commands like "reconcile all bank accounts for June" or "explain why cash doesn't tie out" that autonomously work and log everything.
- No Git-style rollback / restore that an auditor can trust.

The Git model requires full history, diff, blame, branch/merge for reconciliations, and autonomous AI commits when confidence is high.

See the dedicated Git Model document for the exact philosophy.

### 3. Tax Compliance & Filing Exports (Major Gap for Legit Use)
- No structured export for VAT returns (UStVA DE, OSS, MOSS), sales tax returns, or corporate tax.
- No 1099 / information return support (US).
- No fixed assets / depreciation schedule.
- No e-invoicing formats (ZUGFeRD, Peppol, Factur-X).
- AI tax suggestions exist but are not grounded in official sources (see question 4).

### 4. Audit / Compliance Exports & Retention
- No "Audit Package" export (full trial balance + journals + events + invoices + reconciliations + source docs for a period).
- No long-term immutable archival or retention policy tooling.
- Limited support for external auditor workflows.

### 5. Reliability & Ops Polish
- Rate limiting not consistently enforced on chat, invoices, journal, feeds.
- Error boundaries exist but are not comprehensive across all panels.
- Many silent `catch {}` still present (observability gaps).
- No structured logging / request IDs / correlation.
- Docker / compose is basic (needs multi-stage + prod example + secrets handling).
- No E2E or load testing story.

### 6. Advanced Accounting Features (Often Expected)
- Fixed assets & depreciation.
- Payroll integration / 1099s (US) or equivalent.
- Multi-company / consolidation.
- Inventory / cost of goods.
- Project / time tracking integration for revenue recognition.
- Stronger approval workflows / segregation of duties for teams.

### 7. Documentation & Runbooks
- No RUNBOOK, DEPLOY.md, SECRETS.md, or auditor-facing docs.
- Limited rollback / disaster recovery guidance.

---

## Deployment / Self-Hosting Checklist (Still Needed)

- [ ] HTTPS + secure headers everywhere
- [ ] Automated daily + pre-update backups
- [ ] Log rotation + monitoring (health + optional metrics)
- [ ] CI green on every push
- [ ] Tested update/rollback procedure
- [ ] Documented data retention & deletion (GDPR/CCPA ready)
- [ ] Tax authority export flows implemented or clearly scoped as future

---

## Security & Compliance Notes (Summary)

- All financial changes go through audited paths (Event table).
- Secrets (bank creds) are encrypted at rest.
- Webhook signatures are verified when keys present.
- Chat Lock (advisory mode) is respected.
- Still missing: comprehensive rate limiting, full test coverage, classical reconciliation reports, tax filing exports, audit package export.

---

## Definition of "Production Ready" for entrytwo (2026 target)

A user or small firm should be able to:
1. Run it reliably in production (CI, Docker, monitoring, backups).
2. Trust the numbers for tax and audit (correct journals + tax + FX + reconciliation reports).
3. Export what tax authorities and auditors need (structured returns, audit package, source retention).
4. Use AI assistance confidently because high-risk actions always require human review + the system surfaces sources.

Current state is **excellent for an advanced internal tool** and already better than many small-business accounting apps in core accounting quality.  
It is **not yet suitable as the sole system of record for regulated or audited entities** without the gaps above being closed.

---

**Next priority areas (recommended order) — All under the Git Model:**

See `docs/Git-Model-Implementation-Plan.md` for the detailed, authoritative step-by-step plan.

High-level order:
1. **G0 Foundations**: Snapshot service + replay engine + main branch concept (core for rollback and time travel).
2. **G1 Git Operations**: createBranch, merge, tag, diff, blame, restore (with full audit). Chat support for these.
3. **G2 AI Autonomy + Reconciliation**: High-confidence autonomous entries, chat commands for "reconcile", "explain discrepancy", "restore". AI-driven reconciliation that outputs the classical report.
4. **G3 UI Surfaces**: History view, branch management, rollback preview, reconciliation dashboard.
5. **G4 Tests + Full Integration + Verification**: Comprehensive tests for replay, branches, autonomy, rollback. Wire everything (chat, ledger, feeds, invoices, reports). Build + lint + tests green.

**This Git model implementation is now the #1 priority for making the product deliver on "no need to hire a bookkeeper for routine work".** All other items (CI, tax exports, etc.) remain important but must be compatible with this model.

This document (and all others) will be updated as each phase of `docs/Git-Model-Implementation-Plan.md` is completed and tested.
