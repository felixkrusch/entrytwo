# Git Model for Accounting — Implementation Plan

**Status:** Authoritative detailed plan. All work on the Git model must follow this until complete and tested.

**Date:** 2026-07-02 (updated with accountant-friendly UI: commit list, recent-states dropdown, persistent view indicator, 12 propositions)

**Parent Document:** `docs/Git-Model-for-Accounting.md` (read this first — it is non-negotiable philosophy).

This plan exists so that the vision does not get lost. We will implement until it is 100% working, audited, and tested.

## 1. Goals (What "Done" Means)

By the end of this implementation:

- The system behaves like a Git repository for the books:
  - Every journal change is an immutable, attributable commit (Event).
  - You can create named branches for AI work or experiments.
  - You can merge branches (with audit).
  - You can tag important states (closes, tax filings, auditor snapshots).
  - You can diff any two points in time.
  - You can blame any account or transaction.
  - You can restore/rollback the entire state (or specific accounts) to any previous point safely, with full history preserved.
- AI (via chat) can:
  - Be told "reconcile all accounts for June" or "reconcile 1100" and autonomously do the work (creating entries at high confidence, logging everything).
  - Be asked "why doesn't cash tie out?" and give a proper, sourced explanation + proposed fixes.
  - Be told "restore the books to 2026-06-15 14:30" and actually do a safe rollback (creating audit events for the action).
- High-confidence AI actions commit autonomously (no human button press required for routine work).
- Lower-confidence or risky actions create proposals on branches.
- Reconciliation produces the classical report as its natural output (no separate manual path required for the report itself).
- Every action (human or AI) is fully logged with reasoning, confidence, sources, and is reversible.
- The classical "bank reconciliation report" is just an export/view of a successfully reconciled state.
- Full test coverage for replay, branching, autonomy rules, rollback, and audit.
- Build + lint + tests are green.

If any of the above is not working end-to-end from chat + UI, it is not done.

## 2. Current State (as of 2026-07-01)

- `Event` table exists and is used for audit (good foundation).
- `Snapshot` model exists but is almost unused (just id + json + createdAt).
- Journal entries are treated as mostly immutable (reversals are used).
- Bank feed matching exists (pending → match/post), but it is not yet "Git model reconciliation".
- Chat can suggest entries; user must always click to create (no autonomous high-confidence path yet).
- No branches, no tags for accounting state, no replay engine, no chat-driven rollback, no "reconcile via chat" that does real work.
- Reconciliation reports do not exist as first-class artifacts.

We have the audit log bones. We do **not** have the Git model yet.

## 3. Phased Implementation (Do in This Order)

### Phase G0 — Foundations (Infrastructure)

1. Formalize the concept of an "Accounting State Pointer" (current head of main, plus branches).
   - Add minimal models or metadata:
     - `AccountingBranch` (or use lightweight metadata): name, headEventId or headSnapshotId, createdBy, createdAt, description.
     - Or start simpler: use `Setting` keys like `git.main.head`, `git.branches.<name>.head` + a proper table later.
   - For now, introduce `AccountingBranch` model + migration.

2. Snapshot creation service.
   - Create `lib/accounting/snapshot.ts` (or similar).
   - On demand + periodic (after closes, or on schedule).
   - Snapshot must capture enough to reconstruct balances + open items (at minimum: all accounts + current journal lines up to a point, or a full dump of relevant tables + event cursor).
   - Store in `Snapshot.data` as structured JSON (start with full current state + the event id it corresponds to).

3. Replay / reconstruct engine.
   - `lib/accounting/replay.ts`: given a snapshot + list of events after it → produce the state at that point (balances per account, open feed transactions, open invoices, etc.).
   - This is the core of "checkout any point in time".

4. Basic "main" branch.
   - On startup or first use, ensure there is a `main` branch pointing at the latest event/snapshot.
   - All normal creation writes to main by default.

**Deliverable for G0:** We can take a snapshot, replay from it to a specific event, and know what the "main" head is.

### Phase G1 — Git Operations (Core Commands)

Implement these operations (first via internal API + chat, later nice UI):

- `createBranch(name, fromPoint)` — from a date, event id, snapshot, or current head.
- `listBranches()` + current head per branch.
- `mergeBranch(source, target)` — apply the net effect of source onto target as new events (or create reversing + re-applying commits). Always create new events.
- `tag(name, point)` — create a named tag (can be on main or any branch). Tags are immutable pointers.
- `diff(from, to)` — produce human + machine readable diff of what changed in accounts, plus list of events.
- `blame(accountCode, asOf?)` — show history of changes to that account (which events touched it).
- `restoreTo(point, options)` — safely move a branch head to a previous point.
  - Must create a "rollback" event.
  - Must be previewable ("show me the diff first").
  - Default: restore main. Support restoring a specific branch.

All operations must:
- Be fully audited (new Event entries of type like `BRANCH_CREATED`, `MERGE`, `TAG_CREATED`, `ROLLBACK`).
- Preserve history (never delete events).
- Be callable from chat.

**Chat integration (high priority):**
- User: "create a branch called ai-june-recon"
- User: "merge ai-june-recon into main"
- User: "tag this as june-close-2026"
- User: "restore to 2026-06-15"
- User: "diff between june-close and now"

### Phase G2 — AI Autonomy + Reconciliation as First-Class AI Work

1. High-confidence autonomous journal creation.
   - In `/api/chat` and journal creation paths, add a clear rule:
     - If `confidence >= 0.85` (or configurable) AND no ambiguity flags AND not locked → create the entry directly (autonomous commit on current branch, default main).
     - Record in the event payload: `aiAutonomous: true`, `confidence`, `model`, `reasoning`, `sources`.
   - Lower confidence or risky → return suggestion as before (user or chat can decide to apply to a branch).

2. Chat-driven reconciliation.
   - Extend chat route + agent to understand:
     - "reconcile 1100 for June"
     - "reconcile all bank accounts last month"
     - "explain why 1000 is not zero"
   - The AI will:
     - Use the replay engine to look at state at start/end of period.
     - Analyze feed transactions vs journal lines.
     - Use learned merchant prefs + existing matching logic.
     - Propose (or autonomously create at high confidence) clearing adjustments and correcting entries.
     - On success, produce a reconciliation artifact (store or generate on demand).

3. Reconciliation report as output.
   - Create a structured output (and PDF/JSON export) that looks like a classical bank reconciliation:
     - Period
     - Account
     - Statement ending balance (user provides or from feed)
     - Ledger balance at point
     - Cleared items (with references)
     - Outstanding items
     - Adjustments made (with links to the journal entries the AI created)
     - Final tie-out
     - Performed by (AI or human), timestamp, confidence summary
   - This report is just a view/export over a successfully reconciled state. No need for a separate "manual reconciliation" flow for the report itself.

4. Logging + explainability.
   - Every autonomous action and every reconciliation step must be queryable (via events + new `ReconciliationRun` or just rich event payloads).

### Phase G3 — UI Surfaces (Make It Usable) — Accountant-Friendly by Design

All Git terms must remain exact (commit, branch, merge, tag, restore, head). UI copy and labels must be written for accountants.

Core surfaces (inspired by GitHub commit list and v0.app recent-versions dropdown):

- **Commit History List** (GitHub-style `/commits/main`):
  - Reverse-chronological list of Events (journal entries + Git model events: BRANCH_CREATED, MERGE, TAG_CREATED, ROLLBACK, AI_AUTONOMOUS_ENTRY, etc.).
  - Columns/rows: date, short description, actor (human email or "AI:<model>"), stable id (event id or short SHA).
  - Click a commit → dedicated view showing exactly the changes (journal lines added, or net effect for system events).
  - Filterable by account, date range, branch, actor (human vs AI), event type.
  - This becomes the primary everyday "what happened" view. It builds on the existing AuditLogPanel + /api/events.

- **Recent States Dropdown / Selector** (v0.app-style):
  - Lightweight dropdown or pills near the top (dashboard or persistent header).
  - Lists the last N commits + important tags on the current branch/head.
  - Selecting one immediately loads that point-in-time view (updates branch + asOf URL params) across dashboard, ledger, reports, accounts, etc.
  - Prominent "Restore this state" (or "Make this the current state") action — always requires preview first.

- **Persistent "Current Books View" Indicator**:
  - Always visible calm banner/pill (e.g. in TopBar or just below it, and inside panels).
  - Examples: "Viewing: main (current official books)" or "Viewing: ai-june-recon branch • as of 2026-06-15 (tagged 'june-close')".
  - Clicking it opens a small popover with branch switcher + recent states + "return to main".
  - Must reflect URL state (branch + asOf) live.

- **Branch List with Accountant Framing**:
  - "main — Official books (protected, single source of truth)"
  - Other branches shown as "Working area / AI experiment" with creation date and last activity.
  - Quick actions: "Switch to this view", "Merge into main" (only for non-main), "Tag current state".

- **Restore Flow (Time Travel)**:
  - Always preview-first: show table of account balance impacts (current vs target).
  - Clear language: "This will create a new ROLLBACK commit and move the head. All previous history remains. You can restore to any earlier point afterward, including before this restore."
  - "Restore to main" is allowed but is a new audited commit (never rewrites history).

- **Merge as Deliberate Acceptance**:
  - Primarily offered when viewing a non-main branch: "Merge this branch's changes into main".
  - Show net account changes (diff summary) before confirmation.
  - Creates MERGE event + advances target head.

- **Tags as Bookmarked States**:
  - "Tag current view" prominent for month-end close, auditor snapshot, tax filing version.
  - Tags appear in recent-states selector and commit list.
  - Clicking a tag loads that exact point.

- **Diff and Blame as Context Actions**:
  - Not top-level scary buttons. Surfaced from ledger, journal, or account: "Show changes since last tag", "Blame this account".
  - Results are readable tables, not raw JSON.

- **Contextual Git State in All Panels**:
  - AccountsPanel, JournalEntriesPanel, LedgerView, ReportsPanel, ProfitLossPanel must show subtle "as of [date/branch]" when not on current main.
  - When on a branch/historical view: visible banner "Working branch or historical view — does not affect main until merged."

- Other G3 items (still required):
  - Reconciliation dashboard integrated with ledger.
  - Point-in-time support in LedgerView and reports (already partially wired via branch/asOf).
  - Rollback / Restore UI with preview.
  - Full integration of branch/asOf into chat-driven ledger open and autonomous actions.

These surfaces must make the Git model feel like a trustworthy accounting tool rather than developer version control.

The 12 Accountant-Friendly Git UI Principles (documented in Git-Model-for-Accounting.md section 2.2) must be followed during implementation.

### Phase G4 — Safety, Tests, Polish, and Full Integration

- Comprehensive tests:
  - Snapshot creation + replay produces identical balances.
  - Branch + merge + diff is correct.
  - Autonomous high-confidence path creates entries without human click when rules met.
  - Rollback actually restores state and is fully audited.
  - Reconciliation produces correct classical report structure.
  - AI chat commands for reconcile/explain/restore work end-to-end.
- Chat lock still respected (autonomous actions disabled when locked).
- Rate limiting + error handling on all new paths.
- Full wiring: feeds, invoices, reports, ledger all respect branches / asOf when relevant (start with main + explicit asOf for ledger).
- Update all docs to reflect reality (they should already point here).
- End-to-end manual test script + automated smoke if possible.
- Build + lint + test suite green.

## 4. Data Model Additions (Minimal)

- `AccountingBranch` (new model):
  - id, name (unique per type or with owner), headEventId or headSnapshotId, baseBranch?, description, createdAt, createdBy, isMain (boolean)

- Enhance `Event`:
  - Add event types: `BRANCH_CREATED`, `MERGE`, `TAG_CREATED`, `ROLLBACK`, `RECONCILIATION_RUN`, `AI_AUTONOMOUS_ENTRY`

- Optional later: `AccountingTag` table.

- `Snapshot` usage:
  - Add `eventCursor` or `upToEventId` so replay knows exactly where it ends.
  - Make snapshots richer (or accept that we replay events on top of a base dump).

Start with the simplest thing that works: full state snapshot + replay of subsequent events.

## 5. API / Service Boundaries (Proposed)

- `POST /api/accounting/branches` — create
- `GET /api/accounting/branches`
- `POST /api/accounting/branches/:name/merge`
- `POST /api/accounting/tags`
- `GET /api/accounting/diff?from=...&to=...`
- `GET /api/accounting/blame?account=...&asOf=...`
- `POST /api/accounting/restore` — with preview mode
- Internal services: `createSnapshot()`, `replayToPoint(snapshotId, eventId)`, `getStateAt(point)`
- Extend chat to return special actions for the above (or new structured payloads like `openLedger`, `createInvoice`).

## 6. AI Behavior Rules (Must Be Implemented in Code)

- Default branch for autonomous work: main (unless user specified a branch).
- High confidence autonomous journal creation: only when:
  - confidence >= threshold (start with 0.85, make configurable)
  - no `needsConfirmation` flag
  - not in chat-locked mode
  - not high-risk category (large amount, tax change, etc.)
- All autonomous creations must include rich metadata in the Event.
- Reconciliation commands should prefer creating a branch for the work ("ai-recon-xxx"), do the work there, then offer to merge or auto-merge at very high confidence.

## 7. Testing Strategy

- Unit tests for replay engine (given known events, balances match).
- Integration tests for branch/merge/restore.
- Chat integration tests (or at least scripted flows) for autonomous creation and "reconcile" commands.
- Audit completeness tests (every action produces an Event of the right type).
- Rollback safety: after restore, old events still exist, new rollback event exists, state matches previous point.
- End-to-end: from chat message → autonomous or proposed entries → visible in ledger → report export → rollback → state is correct again.

## 8. Order of Implementation (Strict)

1. G0 foundations (snapshots + replay + main branch concept).
2. G1 basic operations (branch, merge, tag, diff, blame, restore) + audit events.
3. G2 AI autonomy rules + chat commands for reconcile/explain/restore + autonomous creation path.
4. Reconciliation report generation as the output of AI reconciliation.
5. UI surfaces — **Accountant-friendly first**:
   - Persistent "Current Books View" indicator (branch + asOf/tag, visible everywhere).
   - Commit History List (GitHub-style list of commits with click-to-detail).
   - Recent States Dropdown / Selector (v0.app-style quick picker + Restore).
   - Branch list with accountant framing ("main = official", others = working/AI areas).
   - Restore flow with mandatory preview + clear rollback language.
   - Merge as deliberate flow when on non-main branch.
   - Tags as prominent bookmarked states.
   - Contextual state badges in Accounts, Journal, Ledger, Reports.
   - Improved AuditLogPanel as foundation for commit history.
6. Full tests + verification (build, lint, manual flows).
7. Update all docs (they should already reference the Git model).

Do not jump ahead. Each phase must be solid before the next.

## 9. Risks & Mitigations

- Replay performance on large histories → use snapshots aggressively + indexes.
- Complexity of branches in accounting → keep the mental model simple for users ("main" is the truth, branches are for proposals and AI experiments).
- Auditors wanting a single linear history → tags + main branch give them that; branches are optional and visible.
- AI over-autonomy → strict confidence + risk rules + always-logged + easy rollback.
- Data model drift → this plan + the Git model doc are the source of truth.

## 10. Definition of Done for This Plan

- `docs/Git-Model-for-Accounting.md` is implemented in full (not just documented).
- A user or the AI can say "reconcile June" from chat and get a proper classical report + correct books.
- AI creates routine entries autonomously at high confidence.
- Any state can be restored to a previous point with full audit trail.
- History, branches, diff, blame, tags all work.
- Tests cover the critical paths.
- Build + lint clean.
- All relevant docs point to and are consistent with the Git model.

When the above is true and verified, this plan is complete.

---

**This plan is now part of the permanent record. Do not start coding the Git model features without referencing this document.**

Next step after reading: implement Phase G0.
