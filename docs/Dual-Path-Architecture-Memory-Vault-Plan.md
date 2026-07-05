# Dual-Path Architecture + Memory Vault — Implementation Plan

**Status:** Planning + initial implementation steps. Production-ready, zero technical debt.

**Date:** 2026-07-05

**Related:**
- docs/Git-Model-for-Accounting.md (immutable truth)
- docs/Autonomous-AI-Execution-Plan.md (execution rules)
- docs/Two-Pass-Intelligence-and-Structure-Plan.md (why two-pass exists)
- Current chat route and `lib/chat/*`

---

## 1. Goals

- The chat must reliably serve **two distinct roles** without compromise:
  1. **Execution agent** — autonomous or proposed double-entry actions (journals, invoices, contacts, reconciliation, etc.) with strict safety.
  2. **Advisory expert** — tax adviser, bookkeeping advisor, and deep knowledge of how entrytwo works.

- Non-action questions (tax on hypothetical profit, "how does the app handle X", "what if...", general advice) must **not** be forced through action classification + Pass 2 packing. They should get a clean, high-quality answer from the first generation when possible.

- Authoritative basics (business location for tax, base currency, configured tax rates, etc.) are **provided by the app**, not discovered or hallucinated.

- Introduce a **Memory Vault**: persistent, structured, queryable storage (knowledge + learned context) that the system can consult. The LLM can "go into the vault and take what it needs" for advisory work.

- Keep the execution path (two-pass + validation + dispatcher) untouched in spirit — strict, auditable, production-grade.

- Zero technical debt. Every change must be clean, well-scoped, typed, and maintainable long-term.

---

## 2. Core Principles

1. **Separation of concerns is non-negotiable**
   - Execution path = precision + validation + side-effect control.
   - Advisory path = reasoning + explanation + product knowledge + tax logic.
   - They share rich context but have different prompts, different output contracts, and different routing.

2. **Authoritative facts win**
   - Company profile (location/region, base currency, tax setup) is injected as ground truth on every turn.
   - This data comes from Settings + TaxRate tables via a clean provider, not from chat history or model memory.

3. **One generation is often enough for advisory**
   - For non-execution questions we prefer a single, well-grounded generation over forced two-pass packing.
   - We still allow an early lightweight mode decision so we don't waste calls.

4. **Memory Vault is explicit and documented**
   - Not just "more stuff in the prompt".
   - Structured, typed, scoped (company, per-merchant, learned rules, app knowledge).
   - The system controls writes. The LLM can propose or query.

5. **No technical debt**
   - No new "EXPLAIN" hacks that still go through action schemas.
   - No leaking raw JSON to the user.
   - Dead code (e.g. `usedTwoPass` variable) is removed when we touch the area.
   - Comments and routing logic must reflect reality.

6. **Production ready from day one**
   - Clean types, error handling, consistent response shape to client.
   - Build + lint clean.
   - Clear boundaries so future features (more memory types, better retrieval, multi-turn memory) can be added without rewriting the routing.

---

## 3. High-Level Architecture

### 3.1 Two Paths

**Execution Path** (keep existing strict contract)
- Triggered by clear intent to do something (CREATE_JOURNAL, CREATE_INVOICE_DRAFT, RECONCILE_*, PROPOSE_*, MATCH_*, etc.).
- Full two-pass:
  - Pass 1: understanding + candidate action(s)
  - Pass 2: exact schema packing using the schemas in `lib/chat/intent.ts`
- Server-side validation (schema + business + policy + confidence + chat lock)
- Dispatcher decides execute vs propose
- Output may include `suggestion`, `proposedAction`, `executed`, `entityId`, etc.

**Advisory Path** (new first-class path)
- Triggered for tax questions, bookkeeping advice, app explanations, hypotheticals, "how does...", general reasoning.
- Single generation with rich context + Memory Vault access.
- Uses a dedicated advisory system prompt (tax adviser + bookkeeping adviser + app expert).
- Output contract is simple and clean: `{ response: string, ...optional metadata }`
- Never forces structured action output.

### 3.2 Shared Rich Context (per turn)

Built once, used by both paths:
- Chart of accounts
- Tax rates (full, with jurisdiction/type)
- Current balances summary (multi-currency aware)
- Recent authoritative feed rates
- Merchant memory (narrow learned patterns)
- Git view (branch / asOf)
- **Company Profile** (new clean provider): country, region, baseCurrency, default jurisdiction, etc.

### 3.3 Memory Vault (new)

Persistent structured storage for:
- Authoritative company facts (can be the source the Company Profile is derived from or mirrors)
- Learned rules and patterns (beyond merchant memory)
- App knowledge / explanations that should survive turns
- User preferences and corrections relevant to advice

Access model:
- System-managed retrieval (injected into advisory prompt when relevant)
- LLM can propose additions via a controlled mechanism (future)
- Separate from journal data and from execution schemas

Initial scope (step-by-step):
- Start with a minimal typed vault (e.g. key + value + scope + metadata).
- Seed it with company profile facts.
- Make it queryable for the advisory path.

### 3.4 Mode Decision

Early, explicit, low-cost decision:
- "This looks like an executable action" → Execution path (two-pass)
- "This is advisory / explanatory / reasoning" → Advisory path (single generation + vault)

Can be done as part of a lightweight first LLM step or even heuristic + LLM fallback. The decision must be allowed to say "no clear executable action".

---

## 4. Phased Implementation (No Technical Debt)

We will implement in small, reviewable, production-ready increments.

### Phase 0 (done in this session)
- Removed all legacy keyword heuristics (`answerDataQuery` + friends)
- All chat now goes through two-pass or fallback (foundation cleaned)

### Phase 1 — Planning + Authoritative Context (current)
- Create this document
- Introduce a clean `getCompanyProfile()` / Company Facts provider
- Inject it consistently for both paths
- Document what the app must provide

### Phase 2 — Explicit Mode Decision + Advisory Path Skeleton
- Define a stable `ChatMode` type (`EXECUTION` | `ADVISORY`)
- Early mode decision logic (can start simple)
- Create advisory system prompt + generation helper
- Return clean `{ response }` shape
- Keep execution path 100% unchanged in behavior

### Phase 3 — Memory Vault Foundation
- Minimal schema + Prisma model (or appropriate storage)
- Types: `MemoryEntry`, scopes, metadata
- Basic CRUD + retrieval helpers
- Seed with company profile facts
- Wire retrieval into advisory context

### Phase 4 — Route Refactor + Cleanup
- Central routing that sends advisory questions to advisory path
- Remove forcing of non-action questions through action schemas
- Delete dead code (`usedTwoPass`, misleading comments, action-forcing fallback for normal chat)
- Ensure client always gets either proper execution objects or clean text response

### Phase 5 — Production Hardening
- Consistent error handling and fallbacks
- Logging / observability for which path + mode was chosen
- Update relevant docs (this plan + reference in main architecture docs)
- Build, lint, typecheck clean
- Basic manual + automated verification for both paths

---

## 5. Response Contracts (Client-Facing)

Execution path (unchanged):
```ts
{
  response?: string,
  action?: string,
  executed?: boolean,
  proposed?: boolean,
  proposedAction?: {...},
  suggestion?: {...},
  createInvoice?: {...},
  openLedger?: {...},
  ...
}
```

Advisory path (new, clean):
```ts
{
  response: string,
  // optional future: sources, confidence, memoryUsed, etc.
}
```

Client behavior:
- If structured execution fields are present → show buttons / modals / navigation
- Else → render `response` as normal chat text

---

## 6. Memory Vault — Initial Scope & Design Notes

- Purpose: long-term structured memory the advisory role can consult
- Not a replacement for conversation history or the Git model
- Entries should be typed and scoped
- Initial minimal fields (example):
  - id, key, value (structured JSON), scope (company | merchant | user | global), source, createdAt, updatedAt
- Retrieval strategy for Phase 3: simple key/scope lookup + recent relevant items. More sophisticated retrieval can be added later without changing the contract.

Important: Authoritative facts (company location etc.) should be **seeded from the app**, not learned from chat.

---

## 7. Risks & Mitigations

- Risk: Mode decision is wrong on ambiguous input
  - Mitigation: Conservative bias toward advisory for anything unclear. User can always say "create the entry for..." to force execution.

- Risk: Advisory path gives bad tax advice
  - Mitigation: Ground it heavily with real configured TaxRate data + company profile. Make it clear it is advisory.

- Risk: Feature creep in the vault
  - Mitigation: Start tiny. Only add what directly improves the three roles (tax, bookkeeping, app knowledge).

- Risk: Duplication of company facts
  - Mitigation: One provider function. Vault can mirror or reference the same data.

---

## 8. Production Readiness Checklist (for each step)

- [ ] TypeScript clean, no `any` where avoidable
- [ ] No dead/unused variables left behind
- [ ] Comments and code agree
- [ ] Build succeeds (`npm run build`)
- [ ] Lint passes
- [ ] Response shape documented and consistent
- [ ] Execution path behavior unchanged for existing actions
- [ ] Advisory path produces readable text, never raw intent JSON

---

## 9. Next Concrete Steps (after this document)

1. Implement `getCompanyProfile()` (or similar) as a clean, reusable provider.
2. Inject it into the existing chat context building.
3. Add a minimal mode decision + advisory generation path (can be behind a simple flag or routing first).
4. Create initial Memory Vault model + seed logic.
5. Wire advisory context to use the vault.
6. Refactor the main POST handler to choose path cleanly.
7. Remove remaining dead code and update docs.

Each of these will be done as small, reviewable changes with build/lint verification.

---

This plan is intentionally scoped so we can deliver value quickly while keeping the strict execution engine pristine and building a sustainable foundation for the advisory + memory capabilities.
