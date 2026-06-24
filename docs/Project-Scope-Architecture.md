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
- **Translation Ready (i18n)**: The system is designed to support multiple languages from day one.
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
| Audit Logging                  | Full history of all changes                              | Critical |
| PDF Invoice Processing         | Bulk upload of PDFs with AI data extraction              | High |
| Chat Interface                 | Primary way to interact with the system                  | High |
| Dynamic Right Panel            | Context-aware tables and dashboards                      | High |
| Clickable Tables               | Direct editing and actions from the right panel          | High |
| AI Categorization              | AI suggests accounts and tax treatment                   | High |
| Approval Workflow              | AI proposes changes → User reviews and approves          | High |
| Basic Reports                  | Profit & Loss + Balance Sheet                            | High |
| Multi-LLM Support              | Support for multiple language models                     | Medium |

**Out of Scope for MVP:**
- Email forwarding
- Voice input
- Advanced agent memory system
- Version control / rollback
- Automatic bank feeds
- Invoicing module

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
| 0     | Accounting Foundation              | Double-entry core + audit logging                     |
| 1     | AI Agent MVP                       | Chat interface + PDF processing + basic agent         |
| 2     | Reliability Layer                  | Memory system + verification + rollback               |
| 3     | Productization                     | Licensing, onboarding, migration tools                |
| 4     | Advanced Capabilities              | Deeper reasoning and more autonomy                    |

---

## 8. Notes

- The project is being built with long-term product potential in mind.
- entrytwo is designed to be **translation-ready (i18n)** from the beginning.
- This document is a living document and will be updated as decisions are made.

---

**Document Status:** Draft v1