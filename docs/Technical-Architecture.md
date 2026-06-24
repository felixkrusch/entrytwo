# entrytwo - Technical Architecture

**Project:** entrytwo  
**Status:** Draft v1  
**Date:** June 2026

---

## 1. Overview

This document describes the overall technical architecture of entrytwo. The system is designed to be modern, maintainable, and suitable for self-hosting while supporting advanced AI capabilities.

---

## 2. High-Level Architecture

entrytwo is built using a layered architecture:

- **Frontend Layer**: Handles the user interface (chat + dynamic right panel). **Must be fully internationalized (i18n) from the start.** All strings externalized. Locale-aware formatting for numbers, dates, and currencies.
- **AI Agent Layer**: Responsible for reasoning, memory, tool calling, and verification. **Must understand and suggest correct tax treatment** per jurisdiction.
- **Application Core**: Contains the business logic and accounting rules. **Double-entry + tax-aware journal entry creation is mandatory from Phase 0.**
- **Data Layer**: Manages persistence and auditability. **TaxRate model must support jurisdictions, effective dates, tax types (standard/reduced/exempt/zero/reverse charge), and input vs output tax.**

The AI Agent interacts with the Accounting Core through well-defined tools, with safety checks in place.

**Non-Negotiable from Day One:**
- No hardcoded English strings anywhere.
- Proper multi-jurisdiction tax handling (VAT/MwSt/sales tax etc.) is a core architectural concern, not a later addition. No technical debt allowed.
- Multi-currency support: JournalLine stores amount + currency. Base currency, historical FX rates, **automatic conversion to base pinned to transaction/payment date** (fxDate + fxRateToBase + fxSource). 
  - For transactions coming from bank or credit card feeds, the *actual exchange rate applied by the provider* (derived from the exact base-currency amount charged) is authoritative and must be recorded. This is required for correct double-entry reconciliation with the real bank statement.
  - The system may call public central bank FX APIs (examples: ECB Statistical Data Warehouse at https://data.ecb.europa.eu/help/api/data, Bank of Canada Valet at https://www.bankofcanada.ca/valet/docs) to fetch a published historical rate when feed data is not available.
  Currency-aware reporting and tax. Chat/AI must propose correct multi-currency entries with fx metadata.
- Chat Lock safety mode: explicit lock toggle makes chat strictly advisory (no create/modify/reverse actions from chat when locked). Visual state + disabled actions.

---

## 3. Recommended Tech Stack

| Layer              | Technology                          | Reason |
|--------------------|-------------------------------------|--------|
| Frontend           | Next.js 15 + TypeScript             | Modern, fast, excellent developer experience |
| Styling            | Tailwind CSS + shadcn/ui            | Fast UI development with good defaults |
| Tables             | TanStack Table                      | Most powerful and flexible table library |
| Charts             | Recharts / Tremor                   | Clean and easy-to-use charting |
| Backend            | Next.js API Routes                  | Keeps frontend and backend in one codebase |
| Database           | PostgreSQL                          | Reliable and powerful for financial data |
| ORM                | Prisma                              | Strong TypeScript support and migrations |
| AI Framework       | LangGraph + Vercel AI SDK           | Best tools for building reliable agents |
| PDF Processing     | pdf-parse + LLM structured output   | Simple and effective |
| Authentication     | Auth.js                             | Easy and secure authentication |

---

## 4. Key Architectural Decisions

| Decision                        | Choice                                      | Rationale |
|--------------------------------|---------------------------------------------|---------|
| Frontend Framework             | Next.js (App Router)                        | Best balance of performance and developer experience |
| Database                       | PostgreSQL                                  | Industry standard for financial applications |
| AI Orchestration               | LangGraph                                   | Provides good control and observability |
| State Management               | React Server Components + Zustand           | Keeps things simple |
| Event Sourcing                 | Hybrid (Events + Snapshots)                 | Good auditability without excessive complexity |
| Multi-LLM Support              | Custom router + Vercel AI SDK               | Flexibility to switch models easily |

---

## 5. System Layers

### Frontend Layer
- Chat interface (left panel)
- Dynamic right panel (tables, dashboards, context)
- Clickable and interactive elements
- **Full i18n support required** — every label, message, report header, and error must come from the i18n system. Locale-aware formatting everywhere.

### AI Agent Layer
- LLM Router
- Agent Memory System
- Verification Engine
- Tool Calling & Approval System
- **Tax intelligence** — agent must be able to propose correct tax lines and tax accounts based on jurisdiction and transaction type.

### Accounting Core
- Double-Entry Engine **with tax line support**
- Audit Logging
- Version Control / Rollback support
- **Tax calculation / validation rules** (jurisdiction-aware rates, effective dates, input/output distinction)

### Data Layer
- PostgreSQL database
- Event store for auditability
- Snapshot system for performance
- **TaxRate model** designed for multi-jurisdiction use (jurisdiction, rate, taxType, effective dates, input/output flag)

---

## 6. Risks & Mitigations

| Risk                           | Mitigation |
|--------------------------------|------------|
| Over-engineering early         | Focus on MVP scope first |
| AI reliability issues          | Strong verification + human approval |
| Performance problems           | Use snapshots and proper indexing |
| Security vulnerabilities       | Follow security best practices from day one |
| **Hardcoded English / missing i18n** | Enforce i18n framework + code review rules from commit #1. Zero tolerance. |
| **Weak or missing tax model**  | Tax handling is a Phase 0 deliverable. Expanded TaxRate model + tax-aware journal logic required before real usage. No "add taxes later". |
| **Missing multi-currency foundation** | JournalLine must carry currency + amount + fx fields from Phase 0. **Automatic conversion to base using rate effective on transaction/payment date** (fxDate + fxRateToBase). Actual rates from bank/credit card feeds are authoritative for imported transactions and must be captured for correct double entry. Public central bank APIs (ECB, Bank of Canada, etc.) may be used as fallback sources. Reports and AI must be currency-aware. |
| **Missing chat lock / safety** | Lock icon + advisory-only mode must prevent accidental actions. Guard all create/modify paths originating from chat. |

---

**Current Implementation (2026-06-24):**
- next-intl fully integrated. All user text externalized.
- TaxRate model + taxRateId on JournalLine + live tax selector in modal.
- Chat context includes tax rates. P&L includes taxSummary.
- Journal lines display tax jurisdiction + rate badges when present.
- **Automatic currency conversion pinned to date**: JournalLine.fxDate / fxRateToBase / fxSource fields exist in schema and are stored on creation. UI surfaces currency per line. 
  - For feed imports, the actual rate applied by the bank or card issuer (derived from the exact amounts in the feed) is recorded with `fxSource = "BANK_FEED:..."` and is considered authoritative.
  - The system is designed to optionally call public central bank FX APIs (ECB Statistical Data Warehouse https://data.ecb.europa.eu/help/api/data, Bank of Canada Valet https://www.bankofcanada.ca/valet/docs, etc.) to fetch a published rate when feed data is not available.
  Full automatic base-currency rollups and date-pinned rate lookup (including API integration) are documented as Phase 0 requirements.

**Document Status:** Draft v1 (updated with mandatory i18n + tax architecture requirements — implementation complete)