# entrytwo

**entrytwo** is an AI-native accounting system designed to act as a personal AI accountant.

Replace traditional, form-heavy bookkeeping with a conversational experience where users manage their finances primarily through chat and voice — while maintaining full double-entry accounting, strong auditability, and data control.

Built as a **self-hosted, open-source** solution, giving users full ownership of their financial data.

## Vision

entrytwo follows a **hybrid interface** approach:
- **Left side**: Chat + Voice (primary interaction)
- **Right side**: Dynamic context panel (tables, dashboards, and details)

Key principles:
- Double-Entry Accounting at the core
- AI-First Experience (chat/voice primary)
- Reliability & Safety (verifiable AI actions)
- Full Auditability
- Self-Hosted + Open Source
- Translation-ready (i18n) from day one
- Flexible LLM support

## MVP Scope

| Feature                        | Priority |
|--------------------------------|----------|
| Double-Entry Accounting        | Critical |
| Audit Logging                  | Critical |
| PDF Invoice Processing         | High     |
| Chat Interface                 | High     |
| Dynamic Right Panel            | High     |
| Clickable Tables & Approval    | High     |
| AI Categorization              | High     |
| Basic Reports (P&L, Balance)   | High     |
| Multi-LLM Support              | Medium   |

**Out of scope for MVP:** Email forwarding, voice input, automatic bank feeds, invoicing module.

## Architecture

- **Frontend**: Next.js 15 + TypeScript + Tailwind + shadcn/ui + TanStack Table
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL + Prisma
- **AI/Agents**: LangGraph + Vercel AI SDK
- **Auth (MVP)**: Magic Link via Email (Auth.js)

## Roadmap

1. **Phase 0**: Accounting Foundation (double-entry core + audit logging)
2. **Phase 1**: AI Agent MVP (chat + PDF processing + basic agent)
3. **Phase 2**: Reliability Layer (memory, verification, rollback)
4. **Phase 3+**: Productization & advanced capabilities

## Documentation

All planning docs live in `/docs`:
- Project Scope & Architecture
- Implementation Plan
- Technical Architecture
- AI Agent Architecture
- Security & Compliance
- Detailed Data Model (Prisma Schema)

## Getting Started (Future)

Once implemented:

```bash
git clone git@github.com:felixkrusch/entrytwo.git
cd entrytwo
# setup instructions will go here
```

## License

MIT © Felix Krusch (Krusch Enterprises Inc.)

## Status

Planning phase (June 2026). Core implementation has not started yet.
