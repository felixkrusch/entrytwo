# Autonomous AI Execution via Chat — Implementation Plan

**Status:** Design & planning document. Authoritative guide for making the LLM act autonomously when confident across the *full application*, while protecting all destructive or high-impact operations.

**Date:** 2026-07-02 (expanded to full app scope)

**Parent Documents:**
- `docs/Git-Model-for-Accounting.md` (core philosophy)
- `docs/Git-Model-Implementation-Plan.md`

---

## 1. Vision & Goals

**Desired behavior (user spec):**
- The LLM acts when confident — preferably 100% autonomous for routine work.
- Safe, low-risk actions (journal entries, simple contacts, draft invoices, reconciliations) execute immediately with no extra clicks when the model has high confidence.
- Destructive or high-impact actions (restores/rollbacks, merges, bulk deletes, sending+charging invoices, major tax changes) **always** require explicit user permission.
- Every autonomous action is still a first-class Git-model commit (full history, blame, diff, restore).
- The user never has to "click to apply" for things the system should just do.
- The recovery story (undo) must be trivial and always visible.

This is the evolution from the current "always suggest, sometimes autonomously apply via narrow taxConfidence hack" to a clean, general intent + execution model.

The goal is **full-scope autonomy where appropriate**: the chat should be able to create journal entries, contacts, draft invoices, recurring schedules, match & post bank feed transactions, generate invoices from schedules, reverse entries (in safe cases), trigger light reconciliations, apply templates, etc. — all without forcing the user to click "apply" for routine work.

Non-goals:
- Full arbitrary tool calling / agent loops.
- Removing human oversight for risky, destructive, or configuration-changing operations.
- Autonomous mutation of core master data (chart of accounts, tax rates, users, company settings) without explicit approval.

---

## 2. Current State (as of c26d94e)

Strengths that already exist:
- Structured output via `generateObject` + Zod schema (`SuggestionSchema`) for journals.
- Real autonomous path: `createAutonomousJournal` + `AI_AUTONOMOUS_ENTRY` event + branch head advance.
- `chatLocked` global advisory mode.
- Git model primitives: branches, restore (creates `ROLLBACK`), reconcile (can auto-apply high-conf), events for everything.
- Some chat-driven restore and reconcile already partially wired (but fragile and not generalized).
- Server-side FX enrichment, merchant memory, feed rates, balance validation in several places.

Weaknesses:
- Autonomy decision is tied to one narrow signal (`taxConfidence >= 0.80` or foreign-currency feed check) and only for journals.
- No explicit action classification from the model.
- Restore/merge paths in chat are hacky (fire-and-forget, no preview, no structured payload).
- UI still mostly expects `suggestion` objects and requires button clicks.
- No consistent "I did it" vs "I propose this" response contract.
- Validation is scattered and incomplete for new action types.

---

## 3. Proposed Architecture (High Level)

### 3.1 Single Structured Intent from the Model

Instead of "return a journal suggestion or stream text", the model will return a typed **intent**:

```ts
type ChatIntent =
  | { action: 'CREATE_JOURNAL'; confidence: number; params: JournalParams; reasoning?: string }
  | { action: 'CREATE_CONTACT'; confidence: number; params: ContactParams; ... }
  | { action: 'CREATE_INVOICE_DRAFT'; ... }
  | { action: 'RECONCILE'; ... }
  | { action: 'PROPOSE_RESTORE'; target: string; ... }   // always proposal
  | { action: 'PROPOSE_MERGE'; ... }
  | { action: 'SUGGEST_ONLY'; ... }                      // explicit defer
```

The model always outputs one of these (via `generateObject`). Free-text streaming is used only for pure explanation when no action is intended.

### 3.2 Server-Side Classification (Source of Truth)

The backend owns two lists (or a small decision table):

**SafeAutonomousActions** (can execute immediately at high confidence):
- CREATE_JOURNAL (with balance + account validation)
- CREATE_CONTACT (simple)
- CREATE_INVOICE_DRAFT
- RECONCILE (per-account or light)
- UPDATE_MERCHANT_MEMORY (internal)

**RequiresExplicitConfirmation** (always propose, never auto-execute):
- Any restore/rollback
- Merge
- Invoice SEND + payment initiation
- Large reversals or anything touching closed periods
- Delete contact/account with history
- Anything that would create a ROLLBACK or MERGE event

Rules applied in order:
1. If `chatLocked` → everything becomes proposal.
2. If action is in RequiresExplicitConfirmation → proposal.
3. If confidence < threshold for that action type → proposal.
4. Server validation fails (unbalanced, unknown accounts, unreachable target, etc.) → proposal + error details.
5. Otherwise → execute autonomously.

### 3.3 Dispatcher + Execution Layer

Thin dispatcher in `/api/chat` (or a new `lib/chat/dispatch.ts`):

- Receives validated intent.
- Calls narrow autonomous helpers:
  - `createAutonomousJournal` (already exists)
  - New: `createAutonomousContact`, `createAutonomousInvoiceDraft`, `autonomousReconcile`
- Every execution creates the appropriate `Event` (`AI_AUTONOMOUS_ENTRY`, or new types if needed).
- Returns a clean payload: `{ response, executed: true, action, entityId?, branch?, asOf?, undoHint? }`

For proposals it returns: `{ response, proposedAction: {...}, requiresConfirmation: true }`

### 3.4 Git Model as Universal Safety Net

- All autonomous mutations go through the same commit/branch/event machinery.
- Restores always create a `ROLLBACK` event (never rewrite history).
- The UI can always show "Last action: AI created entry X (event Y). Undo?"
- Destructive actions still benefit from the same audit trail.

---

## 4. Action Taxonomy — Full App Scope

The taxonomy is deliberately exhaustive. Every major domain in the application is classified.

### 4.1 Safe / High-Autonomy (execute immediately at sufficient confidence)
These are routine, reversible via Git model, low blast-radius operations:

**Journals & Core Books**
- CREATE_JOURNAL (any balanced entry the model can resolve to real accounts)
- APPLY_TEMPLATE (journal template)
- LEARN_MERCHANT (update agent memory from a successful categorization)
- RECONCILE_ACCOUNT (single account, high-confidence matches only, using existing reconcile engine with autoApplyHighConfidence)

**Contacts**
- CREATE_CONTACT (basic customer/vendor with name + type)
- UPDATE_CONTACT (light fields: email, phone, notes — not type changes that affect history)

**Invoicing (Draft / Internal)**
- CREATE_INVOICE_DRAFT (from chat, from PDF extraction, from recurring schedule generation)
- CREATE_RECURRING_SCHEDULE (user describes the pattern; creates the schedule record only)
- APPLY_INVOICE_TEMPLATE / SNIPPET (non-financial layout or line-item reuse)

**Bank Feeds & Matching**
- MATCH_FEED_TRANSACTION (single tx → journal using existing matcher + post when clean)
- SYNC_FEED (trigger a sync for a known connection; the actual import of raw txs is read-only until matched)
- IMPORT_FEED_CSV (light, user-initiated style import that lands as pending FeedTransactions)

**Other Routine**
- OPEN_LEDGER / NAVIGATE (pure view change, no mutation)
- EXPLAIN_BALANCE / WHY_OFF (triggers reconcile or diff under the hood, read-only explanation + optional proposal)

All of the above must still pass server validation (balanced, accounts exist, contacts resolvable, etc.). Confidence bar starts at 0.85 for most; can be tuned per action.

### 4.2 Always Require Explicit Confirmation (never auto-execute)
**Destructive / History-Rewriting (Git model operations)**
- RESTORE / ROLLBACK (any point in time)
- MERGE_BRANCH
- TAG_AS_CLOSE or any operation that marks a period "final"
- REVERSE_ENTRY (especially older than a threshold, high-value, or already reconciled)

**Financial Side-Effects & Money Movement**
- SEND_INVOICE (email + Stripe/PayPal checkout creation)
- CHARGE_CUSTOMER or CREATE_PAYMENT_INTENT (any path that actually takes money)
- AUTO_SEND recurring invoices (the `autoSend` flag or immediate send after generation)

**Bulk & High-Impact**
- BULK_REVERSE
- BULK_DELETE (contacts, invoices, entries)
- IMPORT_BACKUP (full data import — can overwrite state)
- MASS_RECONCILE with auto-post across many accounts

**Master Data & Configuration (never autonomous from chat)**
- CREATE/UPDATE/DELETE Account (chart of accounts)
- CREATE/UPDATE/DELETE TaxRate
- Company settings, base currency, default jurisdiction
- User management (roles, invite, delete)
- BankConnection credentials / encryption keys
- LLM provider / API key configuration
- TOTP / auth settings

**Other High-Risk**
- DELETE contact or invoice that has history / payments
- Changing recurring schedule in a way that affects already-generated invoices
- Any action that would touch a tagged close or a period with a RECONCILIATION_RUN or TAG_CREATED event

For anything in this list the model **must** output a `PROPOSE_*` intent. The UI must surface a clear, preview-rich confirmation that names the resulting Git event type (ROLLBACK, MERGE, etc.) and shows impact.

### 4.3 Gray Areas (require explicit policy + often propose)
- Generating + immediately sending a recurring invoice in one step.
- Large journal entries (above configurable amount threshold).
- Cross-currency entries without strong feed-rate evidence.
- Anything on a non-main branch that the model wants to merge.
- PDF/image processing that produces high-value or tax-heavy invoices.
- Autonomous generation of many recurring invoices at once.

These can be configured later via admin settings ("Autonomy strictness").

Thresholds and the two lists above are server-side constants (or Setting values) — **never** solely determined by the model's returned confidence number.

---

## 4.4 Full App Inventory & Autonomy Policy

This section maps every major domain in the current application (as of the state after the Git Model implementation) to its autonomy classification. The chat is the *only* surface that uses the autonomous execution system described here. Direct UI forms, admin pages, webhooks, and cron remain unchanged.

**Core Accounting**
- JournalEntry (create, reverse, templates) → CREATE_JOURNAL / APPLY_TEMPLATE safe; REVERSE_ENTRY generally proposal (especially old/large).
- Account (chart of accounts) → Never autonomous. Chat must not create/edit/delete accounts.
- TaxRate → Never autonomous.
- Event / Audit → Read-only from chat; all mutations create events via the Git machinery.
- Live UI refresh requirement: autonomous mutations must cause the relevant panels (SummaryBar, Accounts, Journal, Reports/P&L, Ledger, Invoicing, Audit, Git controls, BooksViewIndicator) to refresh. The chat response must emit the necessary events (`journal-updated`, `contacts-updated`, `invoices-updated`, `feeds-updated`, etc.).
- Branch / asOf awareness: the autonomous path must know and respect the current `?branch=...&asOf=...` the user is viewing. Execution happens in that context unless the intent explicitly targets another branch/point.

**Contacts**
- Create / light update → Safe autonomous (CREATE_CONTACT, UPDATE_CONTACT).
- Delete, bulk change, VAT re-validation on many → Proposal or blocked from chat.
- lookup-or-create (used by invoicing) → Can be called internally by autonomous invoice creation.

**Invoicing & Payments**
- Draft creation (from chat, PDF, recurring) → Safe autonomous.
- Send email, create Stripe/PayPal checkout, mark paid manually in ways that move money → Always proposal.
- Templates, snippets, QR, PDF generation → Safe (non-financial).
- Recurring schedule creation → Safe.
- Recurring generation (produce drafts) → Safe.
- `autoSend` behavior or immediate send after generation → Proposal.
- Payment webhooks and status callbacks → Outside chat autonomy entirely.

**Bank Feeds & Matching**
- Sync connection → Safe (triggers import of raw transactions as FeedTransaction pending).
- Match single or clean batch → Safe when resulting journal validates.
- Manual match UI or ambiguous matches → Can propose via chat.
- Direct credential management → Never from chat.

**Reports & Views**
- Balance Sheet, P&L, Reconciliation Report, Diff, Blame → Read-only. Chat can trigger computation and navigation (open ledger with branch/asOf).
- Ledger view (dedicated account view) → Chat can autonomously open/navigate (`openLedger` signal with branch/asOf).

**Git Model for Accounting (full surface)**
- Branch create/list → Safe (or lightweight proposal).
- Autonomous commits on main or feature branches → Safe when confidence high and validation passes.
- Restore / rollback → Always PROPOSE_RESTORE + explicit confirmation.
- Merge → Always PROPOSE_MERGE + confirmation.
- Tag (close, auditor snapshot) → Proposal (creates TAG_CREATED event).
- Reconcile (account or full) → Safe for high-confidence auto-apply; otherwise proposes fixes.
- Ancestry queries, blame, diff → Read-only helpers used by autonomous paths.

**Backup & Data Portability**
- Export → Safe (read-only).
- Import (full or partial) → Always proposal or forbidden from chat (high risk of data loss).

**Admin & Configuration**
- Company profile, base currency, default jurisdiction → Never from chat.
- Users, roles, invitations → Never.
- LLM provider, API keys, model selection → Never.
- TOTP / auth settings, bootstrap → Never.
- Update system / apply updates → Never from chat.
- Bank feed connection setup (credentials) → Never.

**Auth & Onboarding**
- Sign-in, magic links, TOTP verify → Outside scope.
- First-admin bootstrap → Outside autonomous chat.

**Other**
- Templates (journal + invoice) → Applying is safe; creating/editing master templates can be proposal.
- Agent memory / merchant learning → Safe (internal side effect of successful autonomous journals).
- Health, status, FX lookup → Read-only utilities.
- Cron jobs (feed sync) → External; results land as pending feed txs that chat can later match.

**Explicitly Out of Scope for Chat Autonomy**
- All webhook receivers (Stripe, PayPal, Salt Edge, Plaid, etc.).
- Direct admin mutation APIs (unless wrapped and classified above).
- Any mutation that would bypass the Event / branch head system.
- Anything that requires real-time external payment confirmation before the action is "done".

If a new feature is added to the app later, it must be classified into one of the two lists (or gray area) before the chat can act on it autonomously.

---

## 5. Technical Work Items

### 5.1 Schema & Prompt Changes (Primarily `/api/chat/route.ts`)
- Introduce a comprehensive `IntentSchema` (Zod) covering **all** actions in the taxonomy:
  - Journals: `CREATE_JOURNAL`, `APPLY_TEMPLATE`, `REVERSE_ENTRY_SAFE`
  - Contacts: `CREATE_CONTACT`, `UPDATE_CONTACT`
  - Invoices: `CREATE_INVOICE_DRAFT`, `GENERATE_RECURRING`, `SEND_INVOICE` (always PROPOSE)
  - Bank/Feeds: `MATCH_FEED`, `SYNC_FEED`, `IMPORT_FEED_CSV`
  - Git model: `PROPOSE_RESTORE`, `PROPOSE_MERGE`, `CREATE_BRANCH`, `TAG_STATE`
  - Admin-ish (always propose or block): `CREATE_ACCOUNT`, `UPDATE_TAX_RATE`, `IMPORT_BACKUP`, etc.
  - Utility: `OPEN_LEDGER`, `EXPLAIN`, `SUGGEST_ONLY`
- The schema must support optional `branch`, `asOf`, and `approved: boolean` (for the second call after user confirms a proposal).
- Update the system prompt with the complete action vocabulary, examples for each domain (journal, invoice, feed match, recurring, restore, etc.), and the hard rule: "Destructive / config / money-moving actions must use PROPOSE_* forms even at 1.0 confidence."
- Provide rich context in every call: current chart of accounts, tax rates, recent merchants + memory, open recurring schedules, known bank connections, current branch/asOf.
- Keep the old `SuggestionSchema` + journal-only path during transition for zero-downtime rollout.

### 5.2 Dispatcher, Validation & Execution Layer
Create `lib/chat/` (or extend existing autonomous module):

- `intent.ts` — types + classification tables (`SAFE_AUTONOMOUS`, `REQUIRES_CONFIRMATION`).
- Validation functions (must be strict):
  - `validateJournal` (balance, accounts exist, fx sane, not touching closed periods)
  - `validateContact`
  - `validateInvoiceDraft`
  - `validateFeedMatch` (tx exists, not already posted, match is clean)
  - `validateRestoreTarget` (event reachable from current head via ancestry; not a future event)
  - `validateRecurringGeneration`
  - `validateNoMasterDataMutation` (reject any attempt to touch accounts/tax-rates/settings from chat)
- Autonomous executors (create proper Events + advance branch head):
  - `createAutonomousJournal` (already exists — generalize)
  - `createAutonomousContact`
  - `createAutonomousInvoiceDraft`
  - `matchAndPostFeedTransaction`
  - `generateRecurringDraft`
  - `runAutonomousReconcile`
- Every execution must:
  - Run inside a transaction where possible.
  - Create the appropriate `Event` (`AI_AUTONOMOUS_ENTRY` or new specific types).
  - Return `{ executed: true, action, entityId, branch, asOf, eventId }`.

For proposals the dispatcher returns structured `proposedAction` with enough data for UI preview + a token or the original intent so the approval call can re-validate + execute.

### 5.3 Destructive / High-Impact Proposal + Approval Flow (UI + API)
- Model outputs `PROPOSE_RESTORE`, `PROPOSE_SEND_INVOICE`, `PROPOSE_MERGE`, `PROPOSE_REVERSE`, etc.
- Response shape: `{ response, proposedAction: { type, params, impactPreview?, gitEvent: 'ROLLBACK' | 'MERGE' | ... }, requiresConfirmation: true }`
- UI (new or extended component) renders a distinct confirmation surface:
  - Human-readable description.
  - Impact table (before/after balances for journals; affected invoices/contacts for others).
  - Git consequence ("This will create a ROLLBACK commit on main").
  - "Cancel" and "Confirm & Execute" (the latter re-calls chat or a narrow `/api/chat/execute-approved` with `approved: true` + original intent).
- On approval the server re-validates (target still reachable, invoice still draft, etc.) before executing.
- All such executions still create the proper Git event.

Special surfaces needed for:
- Restore (reuse or extend existing restore preview API)
- Send + charge invoices
- Bulk operations

### 5.4 UI / Chat Client Updates (`app/app/page.tsx` + supporting components)
- Handle the three main response families cleanly:
  1. `executed: true` → success banner, link to entity, "Undo" button that triggers the appropriate restore or reverse. Fire `journal-updated`, `contacts-updated`, `invoices-updated` etc. events.
  2. `proposedAction` → render the new confirmation card (different styling from normal suggestions).
  3. Classic `suggestion` (legacy path during transition).
- Update the message rendering to show autonomous results with Git context (branch, event id, asOf).
- Support `openLedger`, `reconciled`, `createdAutonomously` style signals for all new action types.
- Make sure PDF upload path (`/api/invoices/process`) can also return executable intents (so "extracted invoice → create draft autonomously" works).
- Keep `chatLocked` respected at the top of every decision: force `requiresConfirmation = true` for everything.

### 5.5 Existing Hack Cleanup & Unification
- Remove or fully replace the fire-and-forget restore block in the fallback path.
- Unify the current reconcile auto-apply (in chat and `/api/accounting/reconcile`) under the new dispatcher.
- Retire the taxConfidence-only gate once the general `IntentSchema` path is live.
- Make sure recurring generation, feed matching, and backup import paths that are currently "direct API only" can be triggered via chat intent when appropriate (with the correct classification).

### 5.6 New Event Types & Audit Enrichment (Prisma + code)
Consider (minimal set):
- `AI_AUTONOMOUS_INVOICE_DRAFT`
- `AI_AUTONOMOUS_CONTACT`
- `AI_AUTONOMOUS_FEED_MATCH`
- `AI_AUTONOMOUS_RECURRING_GENERATE`

Or keep using `AI_AUTONOMOUS_ENTRY` with a richer `payload.action` discriminator. Either way, every autonomous action must be trivially visible in AuditLogPanel, GitModelControls, and the Event API.

Also ensure `introducedByEventId` is set on JournalEntry / Invoice / Contact where relevant so ancestry queries work.

### 5.7 Additional Surfaces That Must Be Aware of Autonomy
- `app/app/InvoicingPanel.tsx` and invoice detail views — must react to autonomous draft creation and show the new "created by AI" badge + undo.
- `app/app/AccountsPanel.tsx`, `JournalEntriesPanel.tsx`, `LedgerView.tsx` — listen for refresh events and show branch/asOf context.
- `app/app/GitModelControls.tsx` and `BooksViewIndicator.tsx` — surface the latest autonomous commit naturally.
- Admin pages (bank feeds, tax, users, update) — must never be autonomously mutable from chat; the intent dispatcher must hard-reject these.
- Recurring invoice list and generation endpoints — autonomous generation should create drafts + events; `autoSend` must still require confirmation.
- Backup import/export — import is always a proposal (or blocked from chat entirely).
- Webhooks (Stripe, PayPal, etc.) remain external and are not routed through the chat autonomy system.

---

## 6. Prompt Engineering Guidelines (Full Scope)

- Role: "You are an autonomous junior bookkeeper for a real double-entry system. You may directly execute routine, low-risk work. You must propose (never auto-execute) anything destructive, financial, or configuration-related."
- Provide a complete action catalog in the prompt with one-line examples:
  - Journals: "add shareholder loan 800 USD", "record office rent 1200"
  - Contacts: "add ACME Corp as customer", "create vendor 'CloudCorp'"
  - Invoices: "draft invoice John for 450 design work", "generate this month's recurring invoices"
  - Feeds: "match the recent Stripe charge from ACME", "sync Stripe feed"
  - Git: "restore to 2026-06-15", "merge ai-june-recon into main" (these must be PROPOSE)
  - Forbidden from chat: "add a new revenue account", "change base currency to GBP", "delete user X"
- Always require `confidence` (0–1) + short `reasoning`.
- Explicit rule: "Any action that would create a ROLLBACK, MERGE, send money, or touch master data **must** use the PROPOSE_* form regardless of confidence."
- Context to inject on every call (reuse/extend existing helpers):
  - Full current chart of accounts
  - Tax rates + default jurisdiction
  - Recent merchant memory + last used categorizations
  - Recent feed rates
  - Open recurring schedules (names + next due)
  - Current branch + asOf (so the model can propose on the right view)
- Teach the model to ask follow-up questions for ambiguity instead of guessing.
- For PDF/image uploads the model receives the extracted text + detected totals/currency/tax hints and should prefer `CREATE_INVOICE_DRAFT` when the language is customer-facing.

---

## 7. Safety, Guardrails & Edge Cases (Full App)

- **Never trust model confidence alone.** Server validation + hard allow/deny lists are the only source of truth.
- `chatLocked` forces advisory mode globally — must be checked first in the dispatcher.
- Master data protection: the dispatcher must explicitly reject (or downgrade to proposal that the UI will never allow) any attempt to mutate:
  - Accounts, TaxRates, Settings, Users, BankConnection credentials, LLM config.
- Validation failures on "high confidence" intents → always return as proposal + attach the errors so the user sees why it couldn't auto-apply.
- Race conditions & concurrent heads: use the existing ancestry + branch head logic; consider adding a lightweight advisory lock or "expectedHeadEventId" check for autonomous commits.
- Side effects & money:
  - Draft invoice creation = safe autonomous.
  - Send / charge / create payment link = always proposal.
  - Recurring with `autoSend=true` change or immediate send = proposal.
- PDF → invoice flow: extraction can be autonomous up to draft; sending the result is proposal.
- Feed matching: only post when the match is clean and the resulting journal is balanced and accounts resolve. Otherwise propose.
- Restore safety: `validateRestoreTarget` must walk ancestry; never allow restoring to an event that is not an ancestor of the current head on that branch.
- Bulk operations: treat as high-risk by default (propose).
- Foreign currency & FX: always run the same enrichment + authoritative feed logic that the current journal path uses.
- Audit: every autonomous action (success or proposal) must be visible in the Event stream with `createdBy` null or "AI:..." and full reasoning.
- Chaos scenarios to handle:
  - Model returns unknown action type → treat as `SUGGEST_ONLY`.
  - Model tries to create journal with 1 line or unbalanced → validation failure → proposal.
  - Model asks to operate on a deleted or non-existent entity → validation failure.
  - User rapidly fires multiple chat messages → system should not create duplicate entries (idempotency via description + amount + short time window is acceptable).

---

## 8. Phased Rollout (Full Scope)

**Phase A — Core Books Autonomy (journals + basic contacts)**
- `IntentSchema` v1 with `CREATE_JOURNAL`, `CREATE_CONTACT`, `SUGGEST_ONLY`.
- Dispatcher + validation for the above.
- Autonomous path re-uses/extends `createAutonomousJournal`.
- New autonomous contact helper + Event.
- UI success banners + refresh events.
- Legacy suggestion path still works.
- Remove taxConfidence-only gate for journals.

**Phase B — Invoicing & Recurring (drafts only)**
- Add `CREATE_INVOICE_DRAFT`, `GENERATE_RECURRING`.
- Wire PDF upload path to return executable draft intents.
- Autonomous draft creation from chat + from extraction.
- Recurring generation creates drafts + events (never sends).
- UI updates in InvoicingPanel and chat.
- Mark any "send" variant as always-proposal.

**Phase C — Bank Feeds & Matching**
- Add `MATCH_FEED`, `SYNC_FEED`.
- Reuse existing `findMatch` + post logic under autonomous guard.
- Only post clean, validated matches.
- Dirty/ambiguous matches become proposals.
- Refresh ledger + journal after autonomous feed posts.

**Phase D — Destructive & Git Operations (proposals + confirmation)**
- Full `PROPOSE_RESTORE`, `PROPOSE_MERGE`, `PROPOSE_REVERSE`, `PROPOSE_TAG_CLOSE`.
- Confirmation UI with previews (reuse/extend restore preview, add impact for others).
- Approval path that re-validates then executes via the real Git functions.
- Clean up all remaining fire-and-forget restore/reconcile hacks in chat.
- Audit log and Git controls must show the new autonomous destructive events.

**Phase E — Remaining Safe Actions + Hardening**
- Templates, merchant memory learning, light bulk operations that stay under safe list.
- Per-action confidence thresholds exposed in admin (if desired).
- Comprehensive test coverage across all new paths.
- Update all docs (this plan + Git model docs + production readiness).
- Final audit that nothing in the "always propose" list can be auto-executed.

---

## 9. Testing Strategy (Full Scope)

- Unit tests for every validation function and the dispatcher decision table.
- Integration tests covering the happy path for each safe autonomous action:
  - Journal, Contact, Invoice Draft, Recurring Generate, Feed Match/Post, Reconcile.
- Tests that every action in the "Always Propose" list is **never** auto-executed even at confidence=1.0.
- `chatLocked` tests: forces proposal for *all* actions.
- Validation failure tests: unbalanced, unknown account, unreachable restore target, master-data mutation attempt → proposal + error surfaced.
- Git model tests: every autonomous execution creates the correct Event type, sets `introducedByEventId` where relevant, advances the branch head correctly, and is restorable.
- Concurrency / race tests (multiple rapid chat messages).
- PDF upload → autonomous draft creation path.
- Recurring schedule → autonomous generation of drafts (without autoSend).
- Feed sync + match flow end-to-end from chat.
- Confirmation flow for destructive actions (restore, merge, send+charge).
- Audit visibility: new autonomous events appear correctly in AuditLogPanel and can be filtered/blamed.
- Cross-model prompt tests (at least OpenAI + one other provider) to catch prompt drift.
- Performance: autonomous path should be comparable to the old "create via modal" path.

---

## 10. Risks & Mitigations (Full App Scope)

- Model misclassifies a destructive / money / config action as safe → Mitigation: server-side hard deny list + validation that runs *before* any execution. The model cannot override the list.
- User loses mental model / trust ("the AI just did things") → Mitigation: every autonomous result shows a clear banner with what was created, the Git event id, branch/asOf, and a one-click undo (or "view commit").
- Partial state (e.g. invoice created but linked journal not) → Mitigation: use DB transactions for compound operations; any failure must leave the system in a consistent state that is still restorable via the Git model.
- Autonomous actions on the wrong branch/asOf → Mitigation: the intent and dispatcher must carry and respect current branch/asOf from the UI; the model is told the current view.
- Master data accidentally changed via chat → Mitigation: explicit hard block in dispatcher + tests that assert rejection.
- Feed matching posts garbage → Mitigation: only post when the matcher returns a clean, balanced, resolvable entry; otherwise propose.
- Recurring generation floods the system → Mitigation: autonomous generation is limited to "generate next due for this schedule" or "generate for this contact"; bulk "generate everything" can be proposal.
- Restore to a point that later turns out to be after a close → Mitigation: `validateRestoreTarget` can consult tags/closes if present; at minimum the confirmation preview must show the target date and any close tags.
- Prompt/model variance produces different action names → Mitigation: strict Zod enum for action types; unknown actions fall back to `SUGGEST_ONLY`.
- Performance regression from extra validation → Mitigation: cache account/tax maps, do cheap checks first, only do ancestry walks when needed.

---

## 11. Success Criteria (Full Scope)

When the plan is fully implemented:

**Everyday autonomous flow works without extra clicks**
- "add a shareholder loan of $800", "record 1200 rent", "add ACME as customer", "draft invoice John 450 for design", "match the latest Stripe payment from ACME", "generate this month's recurring invoices" → all result in immediate execution + clear "Created autonomously" feedback + undo.
- PDF upload of a customer invoice → model extracts → autonomously creates a draft invoice (no manual review required for the draft step).

**Destructive & risky operations are always gated**
- "restore to 2026-06-15", "merge ai-recon into main", "send the invoice and charge", "reverse the big entry from last year" → user always sees a proposal with preview; nothing happens until explicit confirmation.
- Master data (accounts, tax rates, settings, users, bank credentials) cannot be changed from chat at all.

**Git model is the universal backbone**
- Every autonomous action (journal, contact, invoice draft, feed match, recurring generate, etc.) creates a proper Event with correct ancestry and advances the branch head.
- Every such action is visible in the Audit Log, can be blamed, diffed, and rolled back.
- Restore always creates a ROLLBACK commit — history is never lost.

**Safety & control surfaces work**
- `chatLocked` turns the entire chat into pure advisory mode for all actions.
- Validation failures (unbalanced, unknown accounts, unreachable restore target, etc.) gracefully become proposals with explanation.
- Current branch/asOf context is respected and surfaced for all autonomous results.

**No tool-calling complexity**
- The system uses one structured intent + server-side dispatcher + narrow autonomous helpers. No open-ended agent loop or arbitrary tool surface.

**Coverage**
- All major domains (journals, contacts, invoicing + recurring, bank feeds + matching, Git operations, reports/views navigation, templates/memory) have been classified and wired.
- Nothing that should require confirmation can be auto-executed.

---

## 12. Related & Follow-up Documents

- Keep `docs/Git-Model-for-Accounting.md` as the north star; autonomy must never contradict the Git model.
- Reference this plan from `docs/PRODUCTION-READINESS-PLAN.md` and `docs/Git-Model-Implementation-Plan.md`.
- Future supporting docs that will likely be needed:
  - Confirmation UI patterns (restore, send+charge, bulk, merge)
  - Agent memory & learning (how autonomous successes feed back into merchant memory and future confidence)
  - Autonomy configuration (per-action thresholds, amount limits, "strict" vs "normal" mode)
  - PDF extraction + autonomous invoicing flow details

---

## 13. Appendix: Current App Surfaces That Must Be Considered (Non-Exhaustive)

This appendix is a snapshot of the major surfaces present at the time of writing (post Git Model implementation). Any new surface added later must be explicitly classified.

**Chat-driven entry points**
- `/api/chat` (primary — this whole plan)
- PDF/image upload via chat (`/api/invoices/process`)

**Core mutation surfaces (must be callable autonomously or via proposal)**
- Journal entries: `/api/journal-entries`, `/api/journal-entries/reverse`
- Contacts: `/api/contacts`, `/api/contacts/[id]`, `/api/contacts/lookup-or-create`
- Invoices: `/api/invoices`, `/api/invoices/[id]`, `/api/invoices/generate`, `/api/invoices/process`
- Recurring: `/api/recurring-invoices`, `/api/recurring-invoices/[id]`, `/api/recurring-invoices/[id]/generate`
- Bank feeds: `/api/bank-feeds/sync`, `/api/bank-feeds/match`, `/api/bank-feeds/transactions`
- Git accounting: `/api/accounting/reconcile`, `/api/accounting/restore`, `/api/accounting/branches/merge`, `/api/accounting/tags`, etc.
- Templates: `/api/templates`, `/api/invoices/templates`

**Read-heavy / navigation surfaces chat may trigger**
- Reports, ledger view, accounts, audit log (via `openLedger`, `reconciled`, etc. signals)

**Surfaces that must remain out of autonomous reach**
- All admin configuration pages and their APIs (tax, users, company, bank connections credentials, LLM config, update, etc.)
- Auth routes
- Webhook receivers
- Direct backup import (high risk)
- Any route that mutates master data (accounts, tax rates, settings)

---

**This plan is now deliberately comprehensive.** It treats the entire application (journals, contacts, invoicing, recurring, bank feeds, Git model operations, reports/views, admin boundaries, webhooks, etc.) and classifies every major capability so that "the LLM acts when confident" is well-defined and safe across the whole system.

The implementation can proceed phase by phase, but the taxonomy, hard boundaries, and Git model guarantees must be respected from day one.
