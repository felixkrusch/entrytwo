# entrytwo - Detailed Data Model (Prisma Schema)

**Project:** entrytwo  
**Status:** Draft v1  
**Date:** June 2026

---

## 1. Purpose

This document defines the detailed database schema for entrytwo using Prisma. It focuses on supporting full double-entry accounting, strong auditability, version control / rollback capabilities, AI agent interactions, and future multi-user support.

---

## 2. Core Design Decisions

- Use event sourcing for auditability and rollback.
- Keep journal entries immutable after creation (preferred approach).
- Use snapshots + events for performance.
- All financial changes must go through the event system.

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

  journalEntry JournalEntry @relation(fields: [journalEntryId], references: [id])
  account      Account      @relation(fields: [accountId], references: [id])
}

model TaxRate {
  id        String   @id @default(uuid())
  name      String
  rate      Decimal
  createdAt DateTime @default(now())
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

Finalize and test the core models
Implement event logging for all financial changes
Add snapshot creation logic
Build rollback functionality


Document Status: Draft v1