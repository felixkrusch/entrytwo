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

- **Frontend Layer**: Handles the user interface (chat + dynamic right panel).
- **AI Agent Layer**: Responsible for reasoning, memory, tool calling, and verification.
- **Application Core**: Contains the business logic and accounting rules.
- **Data Layer**: Manages persistence and auditability.

The AI Agent interacts with the Accounting Core through well-defined tools, with safety checks in place.

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

### AI Agent Layer
- LLM Router
- Agent Memory System
- Verification Engine
- Tool Calling & Approval System

### Accounting Core
- Double-Entry Engine
- Audit Logging
- Version Control / Rollback support

### Data Layer
- PostgreSQL database
- Event store for auditability
- Snapshot system for performance

---

## 6. Risks & Mitigations

| Risk                           | Mitigation |
|--------------------------------|------------|
| Over-engineering early         | Focus on MVP scope first |
| AI reliability issues          | Strong verification + human approval |
| Performance problems           | Use snapshots and proper indexing |
| Security vulnerabilities       | Follow security best practices from day one |

---

**Document Status:** Draft v1