# entrytwo - Detailed Data Model (Prisma Schema)

**Project:** entrytwo  
**Status:** Draft v1  
**Date:** June 2026

---

## 1. Purpose

This document defines the detailed database schema for entrytwo using Prisma. It focuses on supporting full double-entry accounting, strong auditability, **Git-model version control / rollback capabilities** (see `docs/Git-Model-for-Accounting.md`), AI agent interactions, and future multi-user support.

**This schema exists to enable the Git model for accounting:**
- Events = commits (immutable history)
- Snapshots = fast restore points
- Branches / proposals = parallel realities or AI work
- Replaying events from a snapshot = checkout / restore to any point
- All AI and human actions produce auditable commits

The Git model (`docs/Git-Model-for-Accounting.md`) is authoritative. This schema must support branches, merges, autonomous high-confidence AI commits, AI-driven reconciliation, and full rollback.

---

## 2. Core Design Decisions

- Use event sourcing for auditability and rollback.
- Keep journal entries immutable after creation (preferred approach).
- Use snapshots + events for performance.
- All financial changes must go through the event system.

**Non-Negotiable Foundations (No Technical Debt Allowed):**
- **Internationalization (i18n)**: The data model and all user-facing data must support full translation readiness. Account names, descriptions, event descriptions, and report labels must be externalizable. The application layer (not this schema) must route all strings through an i18n system. No English strings may be hardcoded anywhere.
- **Tax / VAT / Sales Tax as Core**: Tax handling is a foundational requirement from Phase 0. The schema already includes a `TaxRate` model and `taxRateId` on `JournalLine`. This must be expanded early to support:
  - Multiple jurisdictions / countries
  - Effective dates and historical rates
  - Tax types (standard, reduced, exempt, zero-rated, reverse charge, etc.)
  - Input tax vs Output tax classification
  - Proper linking so that tax amounts are correctly recorded and reportable (UStVA, VAT returns, etc.)
  "We'll fix the tax model later" is forbidden. The model must be correct and extensible from the beginning.

- **Admin / Settings**: A `Setting` model (key/value) is used for global configuration (company name, base currency, default tax jurisdiction, etc.). This supports the Admin UI.

---

## 3. Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
}

enum EventType {
  JOURNAL_ENTRY_CREATED
  JOURNAL_ENTRY_REVERSED
  ACCOUNT_CREATED
  CONTACT_CREATED
  AI_ACTION_EXECUTED
  MANUAL_ADJUSTMENT
}

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  name          String?
  role          String   @default("ADMIN")
  createdAt     DateTime @default(now())
  events        Event[]
}

model Account {
  id           String      @id @default(uuid())
  code         String      @unique
  name         String
  type         AccountType
  description  String?
  createdAt    DateTime    @default(now())
  journalLines JournalLine[]
}

model Contact {
  id        String   @id @default(uuid())
  name      String
  email     String?
  type      String
  createdAt DateTime @default(now())
}

model JournalEntry {
  id          String   @id @default(uuid())
  date        DateTime
  description String?
  createdAt   DateTime @default(now())
  createdBy   String?
  lines       JournalLine[]
  events      Event[]
}

model JournalLine {
  id             String   @id @default(uuid())
  journalEntryId String
  accountId      String
  contactId      String?
  debit          Decimal  @default(0)
  credit         Decimal  @default(0)
  description    String?
  taxRateId      String?
  currency       String   @default("EUR")   // ISO 4217, e.g. EUR, USD, GBP
  fxRateToBase   Decimal?                   // derived or looked-up rate: baseAmount / foreignAmount (or inverse as appropriate)
  fxSource       String?                    // Authoritative source of the rate:
                                             //   "BANK_FEED:<provider>:<tx-or-statement-ref>"  (highest priority when available)
                                             //   "STATEMENT:<provider>:<ref>"
                                             //   "ECB" | "BANK_OF_CANADA" | ...
                                             //   "MANUAL"
                                             // Must be recorded for every non-base-currency line.
  fxDate         DateTime?                  // Date the rate was applied by the source (settlement / posting date preferred)

  journalEntry JournalEntry @relation(fields: [journalEntryId], references: [id])
  account      Account      @relation(fields: [accountId], references: [id])
}

model TaxRate {
  id            String    @id @default(uuid())
  jurisdiction  String    // e.g. "DE", "US-CA", "EU", "AT"
  name          String    // e.g. "MwSt 19%", "USt 7%", "Sales Tax 8.25%"
  rate          Decimal   // e.g. 0.19 for 19%
  taxType       String    // "STANDARD" | "REDUCED" | "EXEMPT" | "ZERO" | "REVERSE_CHARGE"
  effectiveFrom DateTime?
  effectiveTo   DateTime?
  description   String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Future: link to accounts if automatic tax accounts are used
  // inputAccountId  String?
  // outputAccountId String?
}

model Event {
  id         String    @id @default(uuid())
  eventType  EventType
  entityType String
  entityId   String
  payload    Json
  metadata   Json?
  createdAt  DateTime  @default(now())
  createdBy  String?
  user       User?     @relation(fields: [createdBy], references: [id])
}

model Snapshot {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  data      Json
}

4. Key Relationships & Rules

One JournalEntry must have at least two JournalLine records.
Sum of debit must equal sum of credit in every JournalEntry.
JournalEntry records should be considered immutable after creation.
All modifications should be done via new events (reversing entries or adjustments).


5. Version Control & Rollback

Every change is recorded in the Event table.
The Snapshot table stores periodic balances for faster reporting and rollback.
To roll back: Find the nearest snapshot and replay events up to the desired point.


6. Key Technical Decisions
Decision,Recommendation,Reason
Event Storage,Dedicated events table,Auditability + rollback
Current State,Maintain in normal tables,Performance
Immutability,Journal entries immutable after creation,Data integrity
Rollback Strategy,Prefer reversing entries,Better audit trail
Snapshots,Create daily or monthly,Fast rollback and reporting

7. Risks & Considerations

Event sourcing adds complexity. Start simple and evolve if needed.
Performance can become an issue with too many events. Snapshots help mitigate this.
AI-triggered changes must go through strict verification and approval.


 8. Next Steps

Finalize and test the core models (including expanded TaxRate)
Implement event logging for all financial changes
Add snapshot creation logic
Build rollback functionality
**Ensure i18n framework is set up and all user-facing strings are externalized before any real data entry**
**Expand tax handling to full jurisdiction + effective date + type support in Phase 0**
**All reports and journal entry flows must be tax-aware and i18n-ready from the first working version**
**Add multi-currency fields to JournalLine (currency + fx metadata) + base currency concept + currency-aware reporting from Phase 0**
**Implement automatic currency conversion pinned to transaction/payment date** (fxDate + fxRateToBase + fxSource per line; base-currency rollups in reports). 
- When importing from bank or credit card feeds, the actual exchange rate applied by the provider for that transaction (derived from the exact base-currency amount moved) must be captured and stored. This is the authoritative rate for double-entry purposes.
- The system may use public central bank APIs such as the ECB Statistical Data Warehouse (https://data.ecb.europa.eu/help/api/data) and Bank of Canada Valet (https://www.bankofcanada.ca/valet/docs) to obtain a published historical rate when feed data is not available.
- `fxSource` must clearly indicate the origin (e.g. "BANK_FEED:Revolut:tx-12345", "ECB", "MANUAL").
**Implement Chat Lock safety mode (lock icon) — chat becomes advisory-only and cannot create/modify/reverse entries when locked**


Document Status: Draft v1 (updated with strict i18n + tax requirements)