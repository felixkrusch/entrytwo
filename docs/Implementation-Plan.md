# entrytwo - Implementation Plan

**Project:** entrytwo  
**Status:** Draft v1  
**Date:** June 2026

---

## 1. Purpose

This document outlines a practical, phased implementation plan for building entrytwo. It focuses on delivering value quickly while keeping the architecture clean enough to scale toward the full vision.

The plan assumes you want to move fast but still build on a solid foundation.

---

## 2. Overall Strategy

We will build in **small, testable phases**, with each phase delivering something usable.

**Core Rule:**  
Build the **Accounting Core** first, then layer the AI on top. Never let the AI layer become more important than the correctness of the accounting data.

**Non-Negotiable from Phase 0:**
- **Internationalization (i18n)**: The system must be fully translation-ready. No English strings may be hardcoded in any UI, chat logic, reports, audit messages, or any user-facing text. All formatting (numbers, dates, currency) must be locale-aware.
- **Tax / VAT / Sales Tax Handling**: Proper multi-jurisdiction tax support (VAT, MwSt, sales tax, etc.) is a foundational requirement. The data model, journal entries, chat suggestions, and reports must handle tax correctly from the beginning. "We'll add taxes later" is forbidden. No technical debt on i18n or tax is ever acceptable.
- **Multi-Currency Support**: Multi-currency is a core accounting foundation. Journal lines must store amount + currency. System must support base currency, historical FX rates (with dates/sources), currency-aware balances and reports, tax in multiple currencies, and AI/chat suggestions that produce correct multi-currency entries. "We'll add multi-currency later" or "we'll fix the model later" is forbidden. No technical debt allowed.

---

## 3. Recommended Tech Stack (MVP)

| Layer              | Technology                          | Reason |
|--------------------|-------------------------------------|--------|
| Frontend           | Next.js 15 + TypeScript             | Fast development, great DX |
| Styling            | Tailwind CSS + shadcn/ui            | Fast and clean UI |
| Tables             | TanStack Table                      | Most powerful table library |
| Charts             | Recharts or Tremor                  | Simple and good-looking |
| Backend            | Next.js API Routes                  | Keeps everything in one repo |
| Database           | PostgreSQL                          | Reliable for financial data |
| ORM                | Prisma                              | Excellent TypeScript support |
| AI / Agents        | LangGraph + Vercel AI SDK           | Best current tools for reliable agents |
| PDF Processing     | pdf-parse + structured LLM output   | Simple and effective |
| Authentication     | Auth.js (Magic Link)                | Easy and secure |

---

## 4. Phased Implementation Plan

### Phase 0: Accounting Foundation (Start Here) — **i18n + Tax are Mandatory**

**Goal:** Build a correct and auditable double-entry core **with full internationalization (i18n) readiness and proper multi-jurisdiction tax support from day one**. No technical debt is acceptable.

**Non-Negotiable Requirements (Phase 0 must deliver these):**
- **Internationalization (i18n)**: The entire application must be translation-ready. Use a proper framework (recommended: next-intl). **Zero hardcoded English strings** in any UI component, chat message, report, label, placeholder, error message, audit description, or email. All user-facing text must be externalized. Locale-aware number, date, time, and currency formatting is required.
- **Tax / VAT / Sales Tax Foundation**: The data model, journal entry creation, and reports must support jurisdiction-specific taxes (VAT, German MwSt, sales tax, GST, etc.) including:
  - Configurable tax rates with effective dates
  - Tax types (standard, reduced, exempt, zero-rated, reverse charge)
  - Input vs Output tax distinction
  - Tax line generation or tagging on journal entries
  - Tax-aware reports (e.g. UStVA-style output)
  "We'll add taxes later" is forbidden.
- **Multi-Currency Foundation**: JournalLine must support amount + currencyCode. System base currency required. Historical exchange rates (date, rate, source). **Automatic conversion to base currency using the rate effective on the transaction/payment date** (pinned via fxDate + fxRateToBase + fxSource on each line). 
  - **Bank/credit card feed rates are authoritative** for imported transactions. When the feed provides the foreign amount and the exact base-currency amount charged, the system records the derived rate and marks the source. This is required for correct double-entry reconciliation with the real bank movement.
  - **PDF uploads must reason about currency and cross-check feeds**: The system must extract currency from PDFs (symbols, codes, "Total in USD", etc.). If a matching automatic credit card or bank feed entry exists, the actual feed rate and currency must be preferred. If the currency is ambiguous or no confident feed match is found, the chat **must ask the user to confirm** before creating the entry.
  - The system should be able to look up rates from public central bank APIs (examples: ECB Statistical Data Warehouse https://data.ecb.europa.eu/help/api/data, Bank of Canada Valet https://www.bankofcanada.ca/valet/docs) when a rate is not available from a feed or statement.
  Currency-aware P&L / Balance Sheet / cash positions. Tax calculations that respect currency. Chat/AI must propose balanced multi-currency entries with correct fx metadata. "We'll add currencies later" is forbidden.
- **Chat Lock Safety Mode**: A visible lock icon in the chat input area. When locked the chat is strictly advisory — it cannot create, modify, or reverse any entries. Action buttons from chat suggestions must be disabled. Clear visual state. Easy toggle. This is a deliberate safety control.

**Tasks:**
- Set up Next.js + Prisma + PostgreSQL
- Create core models: `Account`, `JournalEntry`, `JournalLine`, `TaxRate` (or equivalent), and link tax to journal lines
- Implement double-entry validation (debits must equal credits) **including correct tax line handling**
- Build basic audit logging (Event table)
- Create simple CRUD for accounts and journal entries **with tax support**
- Build basic reports (Profit & Loss, Balance Sheet) **that are tax-aware**
- Set up i18n framework and externalize **all** UI and chat strings
- Ensure all number/date/currency formatting is locale-aware
- **Implement automatic currency conversion** pinned to transaction/payment date (JournalLine.fxDate + fxRateToBase + fxSource; base-currency equivalents in reports). 
  - When importing from bank or credit card feeds, derive and store the actual rate applied by the provider (baseAmount / foreignAmount) and set `fxSource` accordingly. This is the authoritative rate for that transaction.
  - Optionally call public FX APIs (ECB, Bank of Canada, etc.) to fetch a published rate for the date when feed data is not available.

**Deliverable:** A working double-entry accounting backend that you can trust, is fully translation-ready, and handles taxes correctly for multiple jurisdictions from the first commit. No technical debt on i18n or tax.

---

### Phase 1: AI Agent MVP

**Goal:** Add the ability to process invoices and interact via chat.

**Tasks:**
- Set up chat interface (left panel)
- Create dynamic right panel (tables + context)
- Add PDF upload and parsing
- Connect to an LLM (start with Claude or GPT-4o)
- Build basic agent that can:
  - Extract invoice data **including currency** (symbols, codes, "Total in USD", payment currency vs. settlement currency)
  - **Cross-check against automatic credit card / bank feeds** to find the actual applied rate for the transaction
  - Suggest categorizations
  - Create journal entries (with approval)
- **Currency & rate confirmation rule**: If the PDF currency is ambiguous or the system cannot confidently match a feed entry, the chat **must ask the user to confirm** the currency and amounts before creating any entry. Never silently guess the wrong currency when a real feed rate exists.
- Implement approval workflow (AI proposes → User approves)

**Deliverable:** You can upload invoices and turn them into proper accounting entries via chat.

---

### Phase 2: Reliability & Polish

**Goal:** Make the agent more reliable and the system more usable.

**Tasks:**
- Add basic memory system (remember vendors, categories, user preferences)
- Add verification layer (double-check AI outputs)
- Improve right panel interactivity (clickable tables, inline edits)
- Add better error handling and user feedback
- Improve reports and dashboard

**Deliverable:** A usable internal tool that feels reliable.

---

### Phase 3: Productization (Optional)

**Goal:** Make entrytwo ready to be used by others.

**Tasks:**
- Add user management and roles
- Add licensing / activation system (if going paid)
- Improve onboarding experience
- Add data migration tools (e.g. from Xero)
- Clean up UI and documentation

---

## 5. Development Order Recommendation

| Order | What to Build                          | Why |
|-------|----------------------------------------|-----|
| 1     | Database models + Prisma setup         | Foundation |
| 2     | Double-entry logic + validation        | Must be correct |
| 3     | Audit logging                          | Critical for trust |
| 4     | Basic UI (Chat + Right Panel)          | Needed to test |
| 5     | PDF upload + AI extraction             | Core value |
| 6     | Approval system                        | Safety |
| 7     | Basic reports                          | Usability |
| 8     | Memory + Verification                  | Reliability |
| 9     | Polish & edge cases                    | Production readiness |

---

## 6. Risk Mitigation

| Risk                              | Mitigation |
|-----------------------------------|----------|
| AI making incorrect entries       | Strong approval workflow + verification |
| Scope creep                       | Strict adherence to MVP scope |
| Over-engineering the agent early  | Keep agent simple in Phase 1 |
| Poor data model                   | Spend extra time on Phase 0 |

---

## 7. Recommended Starting Point

**Start with Phase 0 only.**

Build a clean, trustworthy double-entry accounting core with audit logging first.  
Once that works reliably, *then* start adding the AI layer on top.

---

## 8. Phase Status & Remaining Work

### Phase 0: COMPLETE
- ✅ Double-entry core with i18n (next-intl, zero hardcoded English)
- ✅ TaxRate model with jurisdiction, effective dates, taxType, input/output
- ✅ Multi-currency on JournalLine (currency, fxRateToBase, fxSource, fxDate)
- ✅ Bank/card feed rates are authoritative
- ✅ Chat lock safety mode
- ✅ Admin UI with user management + company settings + bootstrap gate

### Phase 0.5: Setup & Admin UI - COMPLETE
- ✅ docs/SETUP.md + README documentation
- ✅ First-admin bootstrap flow implemented
- ✅ Setting model for company configuration

### Phase 1: AI Agent MVP - COMPLETE
- ✅ Chat interface + dynamic right panel
- ✅ PDF invoice processing with currency/tax extraction
- ✅ AI suggestions with tax + FX metadata
- ✅ Approval workflow for journal entries

### Phase 2: Reliability & Polish - COMPLETE
- ✅ Merchant memory system (remember vendors, accounts, tax rates)
- ✅ Verification layer (balance check, FX validation, tax validation)
- ✅ Real-time verification in journal modal
- ✅ Enhanced dashboard interactivity and error handling
- ✅ Report date range filtering
- ✅ Audit log detail view (click to expand)
- ✅ Transaction templates panel (save/use/delete recurring patterns)

### Phase 3: Productization - IN PROGRESS
**Remaining:**
- [ ] Magic Link authentication (Auth.js)
- [ ] TOTP 2FA for ADMIN accounts
- [ ] OAuth login (Google, Microsoft)
- [ ] Data export/import for backup/migration
- [ ] Licensing/activation system (optional, for paid distribution)
- [ ] Advanced onboarding flow

### Out of Scope for MVP (explicitly NOT done):
- Email forwarding
- Voice input  
- Automatic bank feeds (manual feed import exists)
- Invoicing module

---
**Current Status (2026-06-24):**
- Phase 0 foundations complete:
  - Full i18n (next-intl) wired across entire UI. Zero hardcoded English strings. All panels, chat, modal, toasts use translation keys.
  - TaxRate model expanded (jurisdiction, effective dates, taxType, input/output). Tax lines supported on journal entries.
  - New Journal Entry Modal shows live tax selector per line.
  - Journal entries now display tax badges when present.
  - Chat backend receives live tax rates in context and fallback suggestions can attach tax.
  - P&L now returns taxSummary (input/output/net) and UI shows it.
- **Multi-Currency**: Fully implemented in core flows:
  - JournalLine carries currency + fxRateToBase + fxSource + fxDate
  - Bank/credit card feed rates are authoritative
  - Automatic date-pinned conversion to base in journal creation, reversals, P&L, Balance Sheet
  - PDF processing extracts currency, cross-checks feeds, and returns FX-enriched suggestions
  - Rich per-currency breakdown (native + base) in reports + UI
  - Dedicated `/api/fx` lookup and `/api/feeds/import` (authoritative BANK_FEED entries)
- **Chat Lock (Safety Mode)**: Implemented (Lock/Unlock toggle, advisory-only mode, blocks create/reverse actions).
- All user-facing text goes through i18n. Tax data is collected at entry creation.
- No technical debt on i18n, tax, multi-currency architecture, or safety controls.

**Admin UI & Setup: IMPLEMENTED (2026-06-24)**
- `docs/SETUP.md` + overhauled `README.md` with complete first-run, Docker, seeding, and bootstrap instructions.
- `docs/ADMIN-UI.md` created and kept up to date.
- `Setting` model + migration added for company/global config.
- Full `AdminPanel.tsx` with:
  - User list / create / role change / delete (all audited via Event)
  - Live editable company settings (name, baseCurrency, defaultTaxJurisdiction)
- First-admin bootstrap:
  - `GET /api/bootstrap/status`
  - Main layout now **gates the entire application** — shows only the bootstrap form until at least one ADMIN exists.
  - Creating the first ADMIN immediately unlocks full UI.
- Default settings seeded.
- All changes go through audit events.
- i18n strings added for Admin UI.

**Document Status:** Draft v1 (Phase 0 foundations + Admin UI + Setup + Bootstrap all implemented)