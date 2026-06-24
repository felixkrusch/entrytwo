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

### Phase 0: Accounting Foundation (Start Here)

**Goal:** Build a correct and auditable double-entry core.

**Tasks:**
- Set up Next.js + Prisma + PostgreSQL
- Create core models: `Account`, `JournalEntry`, `JournalLine`
- Implement double-entry validation (debits must equal credits)
- Build basic audit logging (Event table)
- Create simple CRUD for accounts and journal entries
- Build basic reports (Profit & Loss, Balance Sheet)

**Deliverable:** A working double-entry accounting backend that you can trust.

---

### Phase 1: AI Agent MVP

**Goal:** Add the ability to process invoices and interact via chat.

**Tasks:**
- Set up chat interface (left panel)
- Create dynamic right panel (tables + context)
- Add PDF upload and parsing
- Connect to an LLM (start with Claude or GPT-4o)
- Build basic agent that can:
  - Extract invoice data
  - Suggest categorizations
  - Create journal entries (with approval)
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

This approach significantly reduces risk.

---

## 8. Next Immediate Actions

1. Set up a new Next.js project with TypeScript + Tailwind + shadcn/ui
2. Set up Prisma + PostgreSQL
3. Create the core models (`Account`, `JournalEntry`, `JournalLine`, `Event`)
4. Implement double-entry validation logic
5. Build basic CRUD + audit logging

---

**Document Status:** Draft v1