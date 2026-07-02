# entrytwo — Production Readiness Plan (General + Invoicing Deep Dive)

**Date:** 2026-06-29 (updated 2026-07-01)  
**Status:** Draft for implementation  
**Guiding Philosophy:** See **`docs/Git-Model-for-Accounting.md`** — this is the authoritative foundation. All work must align with the Git model for accounting (branches, merges, autonomous high-confidence AI commits, AI-driven reconciliation producing classical reports, full history + rollback).

**Goal:** Turn the excellent ideas in the docs into a reliable, AI-first, production-grade accounting application, with **invoicing as a first-class, fully integrated feature**, built on the Git model of financial truth.

## 1. Executive Summary

entrytwo is an **AI-first double-entry accounting system**. The chat (left) is the primary interface; the right panel provides live, contextual views and forms.

**Current reality (as of analysis):**
- Strong accounting foundations (JournalEntry/Line with multi-currency + fx + tax, Events, Contacts, Settings).
- Chat + structured suggestions + NewJournalEntryModal work well for journal entries.
- Invoicing is **not production ready** and breaks the core UX pattern:
  - Separate `/invoicing/create` page (full-screen form, no chat on left).
  - `InvoicingContent` (in layout.tsx) is only a list + links.
  - No tax calculation, no journal entries on invoice creation (only broken AR on payment).
  - No real PDF, no AI creation path, static snippets, random numbers, stubs everywhere.
- General app has good bones but lacks tests, CI, hardened Docker, error handling, and complete i18n.

**Vision (from docs, aligned to Git Model):**
See `docs/Git-Model-for-Accounting.md` for the foundational philosophy. Key points:
- The entire accounting state is a Git-like repository: immutable commits, branches, merges, tags, diffs, blame, full history, and safe rollback.
- AI is a first-class contributor that creates journal entries autonomously at high confidence.
- Reconciliation is AI-driven; the classical report is the output of AI work.
- Chat is the primary way to say "reconcile these accounts", "explain the discrepancy", or "restore to <date>".
- Human role shifts to high-level direction and exception review.

Specific to invoicing:
- "Invoice ACME Corp for $5,000 consulting..." via chat or deluxe right-panel form (creates DRAFT + journal, then explicit send).
- Proper double-entry (AR + Revenue + tax output on create; Bank + AR on payment).
- White-label PDF + QR (EPC etc.) + Stripe/PayPal payment links (no "powered by" branding on the invoice itself).
- Smart snippets, templates, extraction, reminders, reports, recurring.
- All actions logged as events; AI proposals can live on branches before merge.

This plan defines **what "production ready" means** and a concrete path to get there, with heavy focus on replanning and fixing invoicing.

## 2. Current State Assessment

### General App
**Strengths**
- Prisma schema is solid (Invoice, InvoiceLine, TaxRate, JournalLine with fx fields, Event, Contact, Setting).
- Multi-currency + authoritative feed rates + tax direction logic.
- Chat with `generateObject` + fallback, chat lock (advisory mode), PDF attachment (expense path).
- NewEntryContext + NewJournalEntryModal (good pattern for suggestions).
- Webhooks (Stripe/PayPal partial), payments create routes, basic company settings.
- Contacts with address/VAT fields.
- Backup/export/import.

**Gaps (Production Blockers)**
- No automated tests (unit/integration/e2e).
- No CI/CD (.github missing, no lint/typecheck/test in pipeline).
- Dockerfile is a joke (alpine + fortune). Compose files minimal.
- Many silent `catch {}` — poor observability.
- Large monolithic `app/app/layout.tsx` (1140+ LOC).
- Incomplete i18n (many English strings, especially in invoicing areas).
- No rate limiting on critical endpoints (chat, invoices, journal).
- Webhook verification is dev-mode lenient.
- No real error boundaries or global error UI.
- No structured logging / tracing.
- Payment providers keys are required for features but not gracefully handled in UI.
- No invoice → journal integration on creation.
- Deployment story weak (no health checks that matter, no prod compose example).

### Invoicing (Critical Area)
**What exists**
- Schema: Invoice + InvoiceLine + taxRate link + paymentLink/stripe/paypal ids + templateData.
- Basic list (`InvoicingContent`).
- Standalone create form at `/invoicing/create` (wrong UX).
- POST /api/invoices (taxAmount always 0, random invoice number, no journal).
- Stripe/PayPal "create payment" routes (open hosted links).
- Webhooks mark PAID + create CASH/AR journal (wrong for revenue).
- Stub PDF (`lib/pdf/invoice.ts` — divides by 100 bug, no real renderer).
- Stub QR endpoint (static SVG).
- Crude `/api/invoices/generate` (regex + first customer).
- Static snippets.
- Events for INVOICE_CREATED only.

**What is missing vs. the feature plan**
- No AI-first creation from chat ("Invoice John for the website work").
- No tax calculation or selector in create flow.
- No journal on invoice creation (AR debit + Revenue credit + output tax).
- No proper lifecycle (SENT, reminders, OVERDUE automation).
- No PDF generation / download / email.
- No real QR (EPC/Swiss/Interac) with company IBAN from settings.
- No templates, recurring, snippets in DB.
- No duplicate detection or history overlay.
- No aging, forecasts, tax obligations reports.
- No branding (logo, colors, fonts) from company settings.
- No integration with contacts (preferred currency, payment terms, language).
- Breaks the left-chat / right-panel pattern.

## 3. General Production Readiness Roadmap (Phased)

### Phase P0 — Foundations (Do this first, 1-2 weeks)
- Fix Dockerfile (multi-stage Node 20/22 + prisma generate + migrate).
- Real docker-compose (dev with postgres + app; prod example with secrets).
- Add basic CI (GitHub Actions): lint, typecheck, build, prisma validate.
- Add minimal tests (at least API contract tests for journal + invoices using vitest + test db).
- Harden all `catch {}` with proper logging + user-visible errors where appropriate.
- Complete i18n sweep (extract remaining strings, especially invoicing).
- Add basic health + readiness endpoints that check DB.
- Enforce Zod + proper error responses everywhere.
- Add rate limiting (lib/rate-limit.ts already exists — wire it to chat/invoices/journal).

### Phase P1 — Reliability & Safety (parallel with invoicing)
- Global ErrorBoundary + toast + error logging.
- Proper webhook signature verification in prod (make dev lenient configurable).
- Secrets handling: never log keys; admin UI only shows "connected" status.
- Add indexes (Prisma) for common queries (invoices by contact/status, journal by date, etc.).
- Structured audit for invoice actions (already using Event — expand).
- Chat lock respected for all action paths.
- Backup/restore already partial — make it robust + test it.
- Add request ID + basic logging middleware.

### Phase P2 — Polish & Ops
- Observability (simple pino or console + correlation ids; optional OpenTelemetry later).
- Performance budgets for reports.
- E2E smoke (Playwright) for critical flows: create journal from chat, create invoice from chat + manual, mark paid.
- Security review (OWASP basics, no SQL injection via Prisma, auth checks).
- Documentation: RUNBOOK, DEPLOY.md, SECRETS.md.
- Monitoring hooks (healthchecks.io or similar in compose).

## 4. Invoicing — Complete Replan (AI-First, Consistent UX)

### 4.1 UX Principle (Non-Negotiable)
- **Always** left = Chat (same component as dashboard).
- **When `view=invoicing`**: right panel = Invoicing view consisting of:
  - Top: Invoice list (filterable by status, contact, overdue, date).
  - Main/lower area or slide-in: **Invoice Creation / Edit Form** (deluxe manual + smart defaults).
- Chat can drive the form: "Invoice ACME for $5,000 website last week" → structured suggestion → prefills right-side form.
- "New Invoice" button (or +) in right panel opens/scrolls to the form (no navigation away).
- Remove or deprecate the standalone `/invoicing/create` route; redirect it.

### 4.2 Data & Accounting Model (Fix the Core)
On **Invoice creation (DRAFT or SENT)**:
- Create the Invoice record (with proper tax calc).
- Create a balanced JournalEntry:
  - Debit Accounts Receivable (1100) — gross or net + tax split (configurable).
  - Credit Revenue (appropriate revenue account) — net.
  - Credit Output Tax (or use tax lines with taxIsInput=false) for the tax portion.
- Store link: add optional `journalEntryId` on Invoice (or via Event payload).
- On **payment received** (webhook):
  - Update Invoice → PAID.
  - Create Journal: Debit Bank/Cash, Credit AR (contact-linked).
- Support partial payments later.
- Currency: respect contact preferred currency or invoice currency; record fx on lines if needed.
- Tax: full calculation using selected TaxRate(s) per line or header. Support mixed rates.

Add to schema (migration):
- `Invoice.journalEntryId` (optional link).
- `Invoice.sentAt`, `Invoice.lastReminderAt`.
- `Invoice.pdfUrl` or store generated PDF bytes (or key).
- Better invoice number generator (sequential per year or configurable prefix).

### 4.3 AI-First Creation Paths
1. **Chat natural language**:
   - Extend `/api/chat` to detect invoice intent.
   - New or extended suggestion type: `{ type: 'create_invoice', invoice: { contactName?, amount, description, lines? } }`.
   - UI in chat shows "Create Invoice" button → opens/scrolls right panel form prefilled.
   - LLM structured output for invoice (contact resolution, line items, currency, due date).

2. **/api/invoices/generate** (upgrade):
   - Use LLM + structured schema for full invoice (not the current regex hack).
   - Resolve contact by fuzzy name or create placeholder.
   - Return draft invoice payload for the right panel.

3. **PDF / email extraction** (future):
   - Reuse or extend `/api/invoices/process` logic but for customer invoices (different from expense receipts).
   - "Paste receipt/email" → suggest invoice lines.

4. **Voice** (stretch): same chat input.

### 4.4 Manual Deluxe Form (Right Panel)
Required fields / UX:
- Customer (typeahead from CUSTOMER contacts; create on the fly).
- Issue date, Due date (smart defaults: 14/30 days; remember last used).
- Currency (default from contact or company base).
- Line items: description, qty, unitPrice, taxRate (selector), lineTotal live.
- Subtotal, Tax breakdown, Grand Total (live, correct rounding).
- Notes, Terms (pull default from company settings or template).
- "Apply snippet" (make snippets DB-backed, editable).
- "Save as Draft" / "Create & Send".
- Real-time PDF preview (side or below — start with HTML, move to real PDF renderer).
- One-click templates (future).

On save:
- Validate balanced tax math.
- Create Invoice + Journal (see 4.2).
- Fire INVOICE_CREATED event.
- If "Send": generate payment link(s), mark SENT, optionally email (future), update sentAt.

### 4.5 Payments & Delivery (Keep Branding in EntryTwo)
- Stripe: Create PaymentIntent or Checkout Session linked to invoice. Store link. On success webhook → PAID + journal.
- PayPal: Create & send PayPal invoice (existing path is close — harden it).
- Local methods: Show IBAN + generate real EPC/Swiss/Interac QR (use `qrcode` lib + proper payload from company.iban + company.name + amount + invoiceNumber).
- "Send via Stripe", "Send via PayPal", "Send PDF + QR only".
- Future: email the PDF with links embedded (no "powered by").

Update webhooks:
- Handle `payment_intent.succeeded` for invoices specifically.
- Also listen for refunds/chargebacks → adjust status + reversing or adjustment entry.

### 4.6 PDF Generation (Real)
Replace `lib/pdf/invoice.ts` stub.
Options (pick one):
- `@react-pdf/renderer` (React components → PDF buffer on server).
- Or `pdfkit` / `jspdf` for lighter.
- Embed logo (from future brand kit or company setting base64/S3).
- Use company settings: name, address, IBAN, default terms, colors/fonts.
- Output: buffer for download + optional store path.

Add endpoint:
- `GET /api/invoices/[id]/pdf` → returns PDF.
- Button in UI: Download PDF, Preview (open in new tab or modal).

### 4.7 Lifecycle & Intelligence
- Status machine: DRAFT → SENT → PAID / OVERDUE / CANCELLED.
- On send: set status SENT, record sentAt.
- Overdue cron or on-list computation.
- Reminders: manual "Send reminder" + future scheduled.
- Duplicate detection: on create, warn if similar amount + contact + recent date.
- Payment prediction (memory): surface "typically pays in X days".
- Aging report (30/60/90) — reuse reports infrastructure.
- Tax obligations report (output tax collected).

### 4.8 Snippets, Templates, Recurring
- Make `/api/invoices/snippets` real (DB model or use Template with `isInvoiceTemplate`).
- Templates: full header + default lines + terms + tax defaults.
- Recurring: basic schedule (weekly/monthly) that creates draft invoices (future phase).

### 4.9 Reports & Integration
- Invoicing stats in right panel or dedicated reports.
- Link invoices to journal entries for traceability.
- P&L / Balance Sheet already currency/tax aware — ensure revenue from invoices flows correctly.

## 5. Concrete Next Steps & File Changes (Prioritized)

### Immediate (Invoicing + Consistency)
1. Refactor invoicing into pattern:
   - Create `app/app/InvoicingPanel.tsx` (list + form area).
   - Update `layout.tsx` to render `<InvoicingPanel />` for `view === 'invoicing'`.
   - Remove or redirect `/invoicing/create` and its layout.
2. Extend NewEntryContext or create lightweight `InvoiceSuggestion` type.
3. Upgrade chat detection for invoice language → produce invoice-prefill suggestion.
4. Implement proper POST /api/invoices:
   - Calculate tax per line + total.
   - Create Invoice + JournalEntry (AR/Revenue + tax output).
   - Return the created object.
5. Add `journalEntryId` to Invoice schema + migration.
6. Fix PDF stub → real generator (start simple).
7. Implement real QR in `/api/invoices/[id]/qr` using company settings.
8. Wire "Send via Stripe/PayPal" to also update status to SENT.
9. Make snippets dynamic (store in DB or Template).

### Accounting Sync
- On invoice create: always post the revenue side.
- On payment webhook: only move AR → Cash (never double-count revenue).
- Add tests for this invariant.

### General Polish (parallel)
- Add tests for invoice create + journal creation.
- Harden payment create routes (graceful when keys missing).
- Add proper sequential invoice numbering (per year or setting).
- Company settings: add IBAN, default payment terms, logo placeholder.
- i18n: extract all new strings.

## 6. Risks & Mitigations
- **Revenue double-counting**: Strict rule — revenue only on invoice creation; payment only affects AR/Cash. Enforce in code + tests.
- **Tax correctness**: Use existing TaxRate + direction logic. Show breakdown in form and PDF.
- **AI hallucinations on invoices**: Always show editable form on right; require user action to create. Use taxConfidence pattern.
- **Payment provider fragility**: Feature-flag the buttons; show clear "not configured" state.
- **PDF rendering perf**: Generate on demand or cache; stream when possible.
- **Breaking existing data**: Invoice creation will start creating journals — backfill plan or mark old invoices.

## 7. Definition of Done (Production Ready)

**General**
- CI green on every push (lint, types, build, basic tests).
- Docker image runs cleanly and connects to DB.
- All critical paths have error handling + toasts.
- i18n complete for main flows.
- Chat lock respected everywhere.
- No silent failures on journal or invoice creation.

**Invoicing**
- Chat can create invoice suggestions that open form on right.
- Manual form on right creates correct Invoice + Journal (AR + Revenue + tax).
- PDF download works with company branding + QR.
- Payment links + webhooks correctly mark PAID and post cash entry.
- List shows status, totals, quick actions.
- Tax is calculated and visible.
- No separate full-page create route.
- Basic duplicate warning and smart defaults.

## 8. Appendix — Quick Wins / Low-Hanging Fruit
- Fix formatCurrency bug in lib/pdf/invoice.ts.
- Make generateInvoiceNumber sequential or use a counter setting.
- Pre-select customer currency in create form.
- Show previous invoices for contact when creating new.
- Add "Mark as Paid" manual button (creates the payment journal).
- Surface invoice totals in reports/summary.

---

This plan translates the ambitious, high-quality ideas in `docs/invoicing-feature-plan.md`, `Technical-Architecture.md`, and related docs into a realistic, phased execution path that respects the existing AI-first left-chat/right-panel architecture while fixing the broken parts.

Ready to implement section by section. Start with the UX consistency refactor + proper accounting on invoice create.
