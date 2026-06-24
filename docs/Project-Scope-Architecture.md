# entrytwo - Project Scope & Architecture

**Project Name:** entrytwo  
**Status:** Planning Phase  
**Owner:** Felix Krusch (Krusch Enterprises Inc.)  
**Date:** June 2026

---

## 1. Vision

**entrytwo** is an AI-native accounting system designed to act as a personal AI accountant.

The goal is to replace traditional, form-heavy bookkeeping with a conversational experience where users can manage their finances primarily through chat and voice, while maintaining full double-entry accounting, strong auditability, and data control.

entrytwo is built as a **self-hosted, open-source** solution, giving users full ownership of their financial data.

---

## 2. Core Principles

- **Double-Entry Accounting**: Everything is built on proper double-entry bookkeeping.
- **AI-First Experience**: The primary way of working is through chat and voice.
- **Hybrid Interface**: Chat is the main interface, supported by a dynamic and clickable right panel.
- **Reliability & Safety**: AI actions must be verifiable. Mistakes should be preventable and reversible.
- **Auditability**: Every data change and AI decision is logged.
- **Self-Hosted + Open Source**: The core remains free and self-hostable.
- **Internationalization (i18n) from Day One (Non-Negotiable)**: The entire application must be translation-ready. **Zero tolerance for hardcoded English strings** anywhere in the UI, chat logic, reports, audit messages, emails, error handling, or any user-facing output. All text must go through a proper i18n system (recommended: next-intl). Number, date, time, and currency formatting must be fully locale-aware from the first line of code.
- **Tax / VAT / Sales Tax as a Core Foundation (No Technical Debt Ever)**: Proper multi-jurisdiction tax handling is a foundational requirement, not a later feature. The data model, journal entry creation flow, chat/AI suggestions, PDF processing, and **all** reports must support jurisdiction-specific taxes (VAT, German MwSt, sales tax, GST, etc.) including:
  - Configurable tax rates with effective dates
  - Tax types (standard / reduced / exempt / zero-rated / reverse charge)
  - Input tax vs Output tax distinction
  - Automatic or assisted tax line generation/tagging
  - Correct tax-aware reporting (e.g. UStVA in Germany)
  Phase 0 must deliver a correct, extensible tax model. "We'll add taxes later" or "we'll fix the model later" is explicitly forbidden. No technical debt is acceptable on this topic.
- **Multi-Currency Support as a Core Foundation (No Technical Debt Ever)**: Multi-currency accounting is a first-class requirement from Phase 0. The system must support:
  - Multiple currencies on journal lines (amount + currency code per line).
  - A system base currency.
  - Historical exchange rates (effective dates, sources).
  - **Automatic currency conversion** to base currency, using the exchange rate effective on the transaction / payment date (pinned via `fxDate` on each JournalLine; `fxRateToBase` + `fxSource`).
  - Support for reputable public central bank APIs to fetch historical rates (examples: ECB Statistical Data Warehouse API at https://data.ecb.europa.eu/help/api/data, Bank of Canada Valet API at https://www.bankofcanada.ca/valet/docs). The system should be able to look up the rate for a given currency pair on or near `fxDate` and record the source.
  - **PDF Currency Extraction + Reasoning + Confirmation**: When processing PDF uploads (invoices, receipts, credit card statements, etc.), the system must:
    - Extract and reason about the currency of the transaction(s) — looking for explicit codes (USD, EUR, etc.), symbols, "Total in USD", payment currency vs. settlement currency, etc.
    - Cross-check against automatic bank or credit card feeds for a matching transaction (date + amount + merchant). If a feed match is found, the original currency from the PDF and the actual applied rate from the feed must be used together.
    - If the currency is ambiguous, the system cannot confidently match a feed entry, or confidence is low, the chat **must ask the user to confirm or correct** the currency and amounts before creating any journal entry.
    - Example: A PDF shows a USD invoice. The system finds the corresponding credit card feed entry. It records the invoice in USD but uses the exact rate and base-currency amount from the feed.
  - **Bank / Credit Card Feed FX Rate Capture (authoritative source for imported transactions)**: 
    - **Core principle**: When a transaction is imported from a bank feed, credit card feed, statement file (CSV, OFX, MT940, CAMT, etc.), or direct bank/processor API, the **actual exchange rate applied by that provider for this specific transaction** is the only rate that matters for double-entry accounting.
    - **Why this must be solid (design reasoning)**:
      - The bank or card network actually moved or charged a precise amount in the base currency. That number is the economic reality.
      - The journal's base-currency side must match exactly what appears on the bank statement / credit card statement.
      - If you instead use a published rate (ECB reference rate, mid-market rate, etc.) for the same calendar day, you will almost always get a different base-currency amount (e.g. 92.37 EUR vs the bank's actual 92.81 EUR). This creates an unreconcilable difference between the ledger and the real cash account.
      - Result: broken bank reconciliation, incorrect base-currency cash positions, wrong P&L in base currency, and loss of trust in the books.
      - Therefore, for any feed-imported multi-currency transaction, the system is **required** to capture the rate that was actually used, not "a rate that would have been reasonable".
    - **How it must work in practice**:
      - If the feed provides both the foreign-currency amount and the exact base-currency amount that hit the account, the system records the two amounts as-is.
      - It derives `fxRateToBase` (base / foreign) from those two numbers.
      - It sets `fxSource = "BANK_FEED:<provider>:<transaction-or-statement-reference>"` and `fxDate` to the date the rate was applied (settlement/posting date when the feed distinguishes it from authorization date).
      - The two amounts (foreign and base) become the source of truth; the fx fields are derived metadata.
    - Many feeds and statements separate "transaction date" from "settlement date". The rate is usually locked on settlement. The system must prefer the settlement date for `fxDate` when available.

  - **PDF Upload Currency Reasoning & Confirmation (non-negotiable for correctness)**:
    - When a user uploads a PDF (invoice, receipt, statement, credit card bill, etc.), the system **must attempt to extract and reason about the currency** of the transaction(s) in the document.
    - Extraction must go beyond just numbers: the AI/PDF layer must look for explicit currency symbols, codes (USD, EUR, GBP, etc.), "Total in USD", "Amount due (USD)", payment method notes, and any indication of the original currency of the invoice vs. the currency in which it was paid.
    - **Cross-check against automatic credit card / bank feeds**: If a matching feed entry exists for the same date/amount/merchant (or close enough), the system **must** prefer the currency and the actual applied rate from the feed for the base-currency side of the double entry.
      - Example: A PDF upload shows a $1,200 USD invoice. The system finds a matching credit card charge on the same day for the equivalent in EUR (or the user's base currency). It should record the original invoice in USD (from the PDF) but use the exact rate and base amount from the credit card feed.
    - **Confidence and user confirmation requirement**:
      - If the extracted currency is ambiguous, the PDF does not clearly state the currency, multiple currencies appear, or the system cannot confidently match a feed entry, the chat/agent **must ask the user or require explicit confirmation** before creating any journal entry.
      - The system should present its best guess ("This looks like a USD invoice for $1,200. I found a matching credit card charge for €1,085 on 2026-06-20 using the feed rate. Confirm or correct the currency and amount?").
      - Only after user confirmation (or when confidence is high and a clean feed match exists) may the system propose or create the entry.
    - This rule exists to prevent the most common multi-currency error: assuming the wrong currency from a PDF and then either ignoring the real feed rate or recording the wrong original currency. Both break double-entry integrity.
  - **Authoritative rate source priority (must be enforced in code and UI)**:
    1. Actual rate / amounts derived from the bank or credit card feed for *this exact transaction* (highest priority and authority for imported data).
    2. Rate explicitly confirmed by the user from the official statement or PDF, with audit trail.
    3. Historical rate looked up from a trusted public source (central bank API) on the appropriate date (only for manual entries or when the feed does not supply the applied rate).
    4. Manual rate entry (must be clearly flagged as such in the UI and audit log).
  - When a feed does not include the base-currency amount, the system may fall back to a published rate but **must** mark the line as "fx estimated from published rate" vs "fx from feed". Reports, reconciliation screens, and the audit trail must make this distinction visible.

  - **PDF Currency Reasoning + Feed Cross-Check Rule**:
    - PDF uploads (invoices, receipts, credit card statements, etc.) must be processed with explicit currency reasoning: extract currency codes/symbols, "Total in USD/EUR", payment method, and any indication of original vs. settlement currency.
    - If an automatic credit card or bank feed entry can be matched (date + amount + merchant or close), the system **must prefer the currency and actual applied rate from the feed** for the base-currency side.
    - If the currency is ambiguous, multiple currencies are present, or no confident feed match is found, the chat **must ask the user for confirmation** before creating any entry. The system should show its reasoning and best guess and require explicit approval.
    - Goal: never silently guess the wrong currency from a PDF when a real feed rate exists. This is required for correct double-entry.
  - Currency-aware reports and balances (P&L, Balance Sheet, cash positions in multiple currencies, with automatic base-currency equivalents).
  - Tax calculations that respect currency (where jurisdiction rules apply).
  - Full i18n + locale-aware formatting per currency (symbols, decimal separators, etc.).
  - Chat/AI suggestions that correctly propose balanced multi-currency journal entries, including appropriate fx metadata.
  The data model (JournalLine must carry currency + amount, plus fx metadata), creation flows, reports, and AI must be currency-aware from day one. Automatic date-pinned conversion (with strong preference for actual bank/card feed rates when available) is mandatory. "We'll add currencies later" or "we'll fix the model later" is explicitly forbidden. No technical debt on multi-currency is acceptable.
- **Safety Modes — Chat Lock (Advice-Only Mode)**: The chat interface must have an explicit "lock" toggle (visible lock icon). When locked:
  - Chat can only give advice, explanations, and suggestions.
  - It must never trigger creation, modification, or reversal of journal entries, accounts, or any financial data.
  - All "Create journal entry", "Post Reversal", or similar action buttons originating from chat are disabled or hidden.
  - The system provides clear visual feedback that the chat is in read-only / advisory mode.
  When unlocked, full agent actions (subject to approval where applicable) are allowed.
  This is a deliberate safety feature to let users consult the AI without risk of unintended changes. The lock state should be obvious and easy to toggle. Future enhancements may persist the preference per user/session.
- **Flexibility**: Users can connect their preferred LLMs.

---

## 3. UI/UX Philosophy

entrytwo follows a **hybrid interface** approach:

- **Left side**: Chat + Voice (primary interaction)
- **Right side**: Dynamic context panel (tables, dashboards, and details)

### Key Rules:
- The **chat** is the main way of working and giving instructions.
- The right panel is **dynamic** — it changes based on the current conversation.
- The right panel is **clickable and interactive** — users can directly edit, approve, or adjust items without having to go through chat.
- Traditional full accounting forms are minimized.
- The experience should feel like working with an intelligent assistant rather than filling out forms.

---

## 4. Key Features

### MVP Scope

| Feature                        | Description                                              | Priority |
|--------------------------------|----------------------------------------------------------|----------|
| Double-Entry Accounting        | Chart of accounts, journal entries, journal lines        | Critical |
| Tax / VAT / Sales Tax Engine   | Jurisdiction-aware tax rates, input/output tracking, reverse charge, reduced/exempt/zero rates, tax line generation or tagging. **Mandatory from Phase 0. No technical debt allowed.** | Critical |
| Internationalization (i18n)    | Full translation readiness (next-intl or equivalent). All UI text, chat messages, labels, reports, errors, and emails must be externalized. Locale-aware number/date/currency formatting from day one. **No hardcoded English strings anywhere.** | Critical |
| Multi-Currency Core            | Journal lines carry currency + amount. Base currency, historical FX rates, **automatic conversion pinned to transaction/payment date**, **authoritative FX rates from bank/credit card feeds take priority**, optional lookup from public central bank APIs (ECB, Bank of Canada, etc.), currency-aware reports, tax per currency, chat suggestions respect currency. **Mandatory from Phase 0. No technical debt.** | Critical |
| Audit Logging                  | Full history of all changes                              | Critical |
| PDF Invoice Processing         | Bulk upload of PDFs with AI data extraction (currency reasoning, tax lines, and cross-check against automatic bank/credit card feeds for the actual applied rate). Chat must ask user to confirm currency or rate when uncertain. | High |
| Chat Interface                 | Primary way to interact with the system                  | High |
| Dynamic Right Panel            | Context-aware tables and dashboards                      | High |
| Clickable Tables               | Direct editing and actions from the right panel          | High |
| AI Categorization              | AI suggests accounts **and correct tax treatment** per jurisdiction | High |
| Approval Workflow              | AI proposes changes → User reviews and approves          | High |
| Basic Reports                  | Profit & Loss + Balance Sheet (tax-aware)                | High |
| Multi-LLM Support              | Support for multiple language models                     | Medium |

**Out of Scope for MVP (explicitly does NOT include the above):**
- Email forwarding
- Voice input
- Advanced agent memory system
- Version control / rollback
- Automatic bank feeds
- Invoicing module

**Non-Negotiable Foundations (MVP must deliver these correctly):**
- The system is **translation-ready (i18n)** from the very first commit. All user-facing text goes through the i18n system. No English strings may be hardcoded in UI components, chat logic, reports, or any user-visible output.
- Tax handling (VAT/MwSt/sales tax/etc.) is a **core accounting concern**, not a later add-on. The data model, journal entry creation, chat suggestions, PDF processing, and reports must support multi-jurisdiction taxes from Phase 0. "We'll add taxes later" is forbidden. No technical debt is acceptable.
- **Multi-Currency** is a **core accounting concern**, not a later add-on. Journal lines must support amount + currency, base currency, historical exchange rates, and **automatic conversion to base using the rate effective on the transaction / payment date** (pinned via fxDate). 
  - **Bank/credit card feed rates are authoritative** for imported transactions. The actual rate applied by the bank/card network (derived from the exact base-currency amount charged) must be recorded. This is required for correct double-entry reconciliation with the real bank statement.
  - Public central bank APIs (e.g. ECB Statistical Data Warehouse, Bank of Canada Valet) may be used for historical rates when feed data is not available.
  Currency-aware reporting/tax/AI from Phase 0. "We'll add currencies later" is forbidden. No technical debt is acceptable.

---

## 5. User & Access Management

### Authentication (MVP)

- Primary method: **Magic Link via Email**
- Later (Phase 2): Optional **TOTP** (authenticator app) as second factor

### Roles

| Role          | Description                     | Permissions                     |
|---------------|---------------------------------|---------------------------------|
| **Admin**     | Full access                     | All actions                     |
| **Accountant**| Can manage financial data       | Most actions                    |
| **Viewer**    | Read-only access                | View reports and data only      |

### Audit & Attribution

Every change to financial data records:
- Which user performed the action
- Whether it was done manually or by the AI
- Timestamp and before/after values

---

## 6. High-Level Architecture

The system is divided into the following layers:

- **User Interface Layer**: Chat + Voice on the left side, with a dynamic right panel containing tables and dashboards.
- **AI Agent Layer**: Handles reasoning, memory, verification, tool calling, and action execution.
- **Accounting Core**: Contains the double-entry engine, audit logging, and version control logic.
- **Data Layer**: PostgreSQL database using event sourcing for full auditability and rollback support.

The AI Agent interacts with the Accounting Core through a controlled set of tools, with an approval workflow for sensitive actions.

---

## 7. Roadmap (High-Level)

| Phase | Focus                              | Key Deliverables                                      |
|-------|------------------------------------|-------------------------------------------------------|
| 0     | Accounting Foundation (with i18n + Tax + Multi-Currency from Day One) | Double-entry core + audit logging + **full i18n** + **TaxRate + tax lines + tax-aware P&L** + **Multi-currency on lines + base currency + FX rates + automatic date-pinned conversion to base + currency-aware reports** |
| 1     | AI Agent MVP                       | Chat interface + PDF processing + basic agent (tax-aware suggestions) |
| 2     | Reliability Layer                  | Memory system + verification + rollback               |
| 3     | Productization                     | Licensing, onboarding, migration tools                |
| 4     | Advanced Capabilities              | Deeper reasoning and more autonomy                    |

---

## 8. Notes

- The project is being built with long-term product potential in mind.
- **Internationalization (i18n) is mandatory from day one.** Every single user-facing string (UI labels, chat responses, error messages, report headers, descriptions, audit log text, emails, etc.) must be externalized through a proper i18n framework. Locale-aware formatting for numbers, dates, and currencies is required. Hardcoded English is not acceptable at any layer.
- **Tax / VAT / Sales Tax handling is a foundational requirement.** The system must correctly support jurisdiction-specific taxes (VAT, MwSt in Germany, sales tax, GST, etc.) including standard/reduced/exempt/zero/reverse charge rates, input vs. output tax, effective dates, and correct reporting from Phase 0 onward. This is not optional and no technical debt is permitted.
- **Implementation status (2026-06-24):** i18n fully wired. Tax foundation live. Multi-currency foundation is now a documented non-negotiable (data model + flows + reports + AI must be currency-aware from Phase 0). **Automatic currency conversion pinned to transaction/payment date** (fxDate + fxRateToBase) is explicitly required in scope. Public FX APIs (ECB, Bank of Canada, etc.) may be used to source historical rates.
- This document is a living document and will be updated as decisions are made.

---

**Document Status:** Draft v1