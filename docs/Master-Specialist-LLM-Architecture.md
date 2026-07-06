# Master + Specialist LLM Architecture (Hard Cut Rewrite)

**Status:** Authoritative implementation plan. Hard cut — no backward compatibility.  
**Date:** 2026-07-06  
**Goal:** Replace the accumulated two-pass + dual-mode + dispatcher-heavy chat system with a simple, maintainable master + specialist flow that gives the LLM proper conversational context while still producing the strict JSON required for real accounting actions.

## 1. Vision & Non-Negotiables

- One coherent conversational experience.
- The model receives full session history (no artificial slice(-8)).
- A single global **Chat Lock** (closed = proposals only; open = normal autonomy rules apply).
- When the lock is closed the chat may still propose actions (show structured card + "Confirm & Execute"), but nothing executes without an explicit user click.
- Strict, correct JSON is required for any mutation (journal, invoice draft, contact, etc.). Free text is never sufficient for creation.
- The Git model (Events + branch heads + ancestry + restore) remains the universal audit + rollback safety net.
- Hard cut: delete everything that exists only for historical layering. No compat shims.

## 2. Core Architectural Decision: Master + Specialist

**Master agent**
- Full conversational context (entire session messages).
- Normal reasoning, tax advice, bookkeeping discussion, app questions, multi-turn refinement.
- Decides when a real action is warranted.
- When it acts, it produces (or delegates for) the exact structured payload.

**Specialist (formatting)**
- Narrow, non-conversational.
- Only job: emit precise JSON that matches the canonical action schemas.
- Can be a separate narrow call or (preferred for simplicity) the master itself is instructed to output the exact shape when it decides to act.

For maximum simplicity we start with the master doing both:
- The master prompt contains the full set of action schemas as "available skills".
- When the master decides an action is needed it outputs a single top-level JSON object instead of (or in addition to) text.
- Server attempts to parse an action; if present and valid → process it. Otherwise treat as normal text response.

A true separate specialist call can be added later only if the single-call approach proves unreliable for strict JSON. We deliberately start simple.

## 3. Lock Semantics (the only mode)

- `chatLocked: boolean` (global, persisted in localStorage as before for the icon).
- Closed (locked):
  - Master is explicitly told: "You are in advisory/proposal-only mode. You may discuss and show proposed actions, but you must never indicate that anything will run automatically."
  - Server always forces `proposed: true` for any actionable output.
  - User must click a confirmation button for execution.
- Open (unlocked):
  - Normal policy applies (confidence, SAFE vs PROPOSE lists, validation).
  - High-confidence safe actions may execute directly.

This replaces the 'advisor' | 'execution' toggle and the conflicting ChatMode types.

## 4. Conversation History

- Client sends the **full** messages array for the current chat session.
- No artificial truncation in the main path (token cost is ignored for now).
- Attachments (raw PDF/image bytes) are sent on the turn they are attached, exactly as today.
- The master sees real prior turns, including previous proposals, user corrections, etc.

## 5. High-Level Flow (per turn)

1. Client
   - Collects full history + current lock state + branch/asOf + any pending files.
   - POST to `/api/chat`.

2. Server context building (unchanged quality, simpler code)
   - Company profile, chart of accounts, tax rates, contacts, balances, recent feed rates, Memory Vault items.
   - Full conversation history is passed to the model.

3. Single master LLM call
   - Rich system prompt that includes:
     - Role (expert double-entry accountant + entrytwo specialist).
     - Current lock state and its consequences.
     - Complete list of action schemas (exact shapes the specialist/master must emit).
     - "When you need to act, output exactly one JSON object with `action` + `params` + optional `confidence`/`reasoning`. Otherwise answer normally."
     - Full context blocks (accounts, tax, FX rules, etc.).
   - When files are present: raw bytes are included in the user message (multimodal).
   - Model returns either:
     - Plain text (advisory / explanation).
     - Or a structured action object.

4. Server processing (thin trusted boundary)
   - If the response parses as a valid action:
     - Re-apply lock: if locked → force proposal.
     - Run domain validation (balanced journal after FX, accounts exist, contact resolvable, restore target reachable, etc.).
     - Apply policy (master data never allowed, destructive actions always propose, etc.).
     - If everything passes and not forced to propose → execute using the Git primitives.
     - Otherwise return as proposal.
   - If no action (plain text) → return `{ response: text }`.

5. Execution path (minimal)
   - Use existing reliable primitives:
     - `createAutonomousJournal` (or equivalent for other entities).
     - Create the correct `Event` (AI_AUTONOMOUS_ENTRY, INVOICE_CREATED, CONTACT_CREATED, ...).
     - `recordCommitOnBranch` (parent to current head, advance head).
   - Never bypass the Event/branch system.

6. Client rendering
   - Text response → normal bubble.
   - Proposal → show proposal card (with the structured payload) + "Confirm & Execute" button.
   - Executed → success banner + entity link + "View entries" etc. + fire refresh events.
   - On confirm: re-POST the structured payload with `approved: true`. Server re-validates then executes.

## 6. Response Contracts (client contract)

```ts
// Normal text / advisory
{ response: string }

// Proposal (lock closed, or policy, or low confidence)
{
  response?: string,
  proposed: true,
  action: string,
  params: object,
  understanding?: string,   // optional rich text from model for display
  sourcePdfPath?: string
}

// Successful autonomous or confirmed execution
{
  response: string,
  executed: true,
  action: string,
  entityId?: string,
  branch?: string,
  asOf?: string,
  createdAutonomously?: boolean,
  // plus any navigation hints the UI already understands
}
```

The client no longer needs to normalize many legacy shapes. Old `suggestion` path can be removed during the cut.

## 7. Deletion List (Hard Cut)

We delete the accumulated layers:

- `lib/chat/chatMode.ts` (entire file)
- `lib/chat/mode.ts` (entire file)
- `lib/chat/advisory.ts` (the separate advisory generator; master handles advisory)
- `lib/chat/dispatcher.ts` (the 900-line orchestration monster; only the pure validation helpers may be salvaged and moved)
- The entire two-pass scaffolding inside `app/api/chat/route.ts` (Pass1Schema, actionItems loop, pass1Prompt + pass2Prompt, etc.)
- All `effectiveMode`, `chatMode` vs `chatLocked` dual logic and fallbacks.
- Legacy `SuggestionSchema` and old single `generateObject(IntentSchema)` paths.
- Client-side mode toggle logic and the `MessageCircle` vs lock icon confusion.
- Any code that still checks the old strings in panels (`JournalEntriesPanel.tsx`, etc.).
- Dead response shape normalization in `app/app/page.tsx`.

Keep (domain, not chat orchestration):
- `lib/accounting/autonomous.ts`, `commit.ts`, `branch.ts`, `ancestry.ts`, restore/merge/reverse, etc.
- Core validation logic (move the pure `validateJournalIntent`, `validateContactIntent`, etc. to a small `lib/validation/` or `lib/chat/validation.ts` if desired — they are useful).
- `lib/llm.ts`, `lib/companyProfile.ts`, `lib/memoryVault.ts`, `lib/agentMemory.ts`, feed rates, etc.
- The Event model and Git invariants.

## 8. New / Simplified Structure

- `app/api/chat/route.ts` — rewritten to be small and obvious (~250-350 lines max).
- One master system prompt (can live in the route or a small `lib/chat/prompts.ts`).
- Thin execution boundary:
  - `lib/chat/apply.ts` (or directly in the route for simplicity) — `applyStructuredAction(action, params, {locked, branch, approved})`.
  - Inside: lock check → validation → decide propose vs execute → call Git primitives.
- Action schemas stay in `lib/chat/intent.ts` (or a new `lib/actions/schemas.ts`) as the single source of truth for what the master is allowed to emit. The schemas are embedded in the prompt and used for server validation.
- Client state: only `chatLocked: boolean`.
- UI: Lock/Unlock icon that toggles the boolean and persists it.

## 9. Prompt Strategy (Master)

The master prompt is the only heavy prompt.

Key sections:
- Role + "You carry the full conversation history."
- Current lock state and exact rules.
- "Available actions (exact strings and shapes)" — paste or reference the schemas from `intent.ts`.
- Multi-currency, FX, tax, Git model, contacts resolution rules.
- "When you decide to act, output **only** the JSON object for the action (no extra prose around it, or clearly fenced). Otherwise answer in normal prose."
- When locked: "All actions must be proposals. The user will have to confirm."

When raw files are attached the user part of the message includes the bytes + "Read the attached document(s) directly."

## 10. Validation & Safety (non-negotiable)

Even with a perfect specialist/master, the server must still:
- Validate schema shape.
- Validate domain rules (balanced after FX, real accounts, reachable targets, etc.).
- Enforce lock (force proposal).
- Block master data mutations.
- Create proper Events + advance branch heads.
- Re-validate on confirmation.

These checks move from the old "dispatcher as god" to a small trusted apply layer.

## 11. Implementation Order (execute in this sequence)

1. Write this plan (done).
2. Create the new thin prompt + apply logic.
3. Rewrite `app/api/chat/route.ts` from scratch for the new flow (full history, single call, lock-only).
4. Update `app/app/page.tsx`:
   - Remove chatMode state and toggle.
   - Use simple `chatLocked` + Lock/Unlock icon.
   - Send full history (remove all slice(-8)).
   - Simplify response handling to the new contracts.
   - Keep proposal confirmation button (it already exists).
5. Move or keep the pure validation functions (they become direct helpers).
6. Delete the files listed in section 7.
7. Update all call sites that still reference the old modes (JournalEntriesPanel, etc.).
8. Update any docs that described the old dual-path / two-pass / ChatMode.
9. Test the main flows:
   - Pure questions / advice (locked and unlocked).
   - Create journal (autonomous when unlocked, proposal when locked).
   - Confirm a proposal.
   - PDF upload + autonomous draft creation.
   - Full history across multiple turns ("use the same merchant as before").
   - Lock prevents execution even at "confidence 1.0".
10. Run lint + typecheck + build.
11. Remove any remaining dead code surfaced by the cut.

## 12. Risks & Mitigations

- Model emits slightly wrong JSON → Server validation fails → returned as proposal with the error text. User sees exactly what was wrong and can correct.
- Loss of the "Pass 1 understanding text" for proposals → We can still ask the master to include a short `reasoning` or let it output a human sentence + the JSON in one turn. Keep the proposal card able to show reasoning.
- Confirmation UX regresses → The existing proposal card + "Confirm & Execute" is preserved and simplified.
- We accidentally delete something Git-related → The Git primitives live in `lib/accounting/*` and are only called from the new thin apply layer. We do not touch them during the chat rewrite.
- Master prompt becomes huge again → We keep it well-structured. Context (accounts, tax, etc.) is built once and injected cleanly.

## 13. Post-Cut State (target)

- `app/api/chat/route.ts` is the only place that talks to the LLM for chat.
- One lock boolean.
- Full history.
- One master prompt + optional narrow specialist (future).
- Thin trusted apply + validation.
- ~1500–1800 lines of chat-related code removed or radically simplified.
- The model feels like a real conversational accountant that happens to be able to do precise work when asked.

## 14. Success Criteria

- User can have a normal multi-turn conversation and then say "create the entry we just discussed".
- When the lock is closed, the same sentence produces a clean proposal that requires an explicit click.
- No more "advisor vs execution" confusion.
- No more Pass 1 / Pass 2 split.
- Deleting the old dispatcher and mode files does not break Git model, validation, or execution.
- The specialist (or master acting as one) reliably produces the exact JSON shapes defined in the schemas.
- Full session history is visible to the model and improves results on follow-ups.

---

This document is the plan. After it is written, execute the hard cut in the order above. No incremental layering on the old system.
