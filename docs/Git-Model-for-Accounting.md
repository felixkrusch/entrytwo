# Git Model for Accounting — The Core Philosophy of entrytwo

**Status:** Foundational. Non-negotiable. This document defines the mental model and operating principles for the entire system. All future design, implementation, AI behavior, UI, and documentation must align with it. This must never be lost or diluted.

**Date:** 2026-07-01  
**Last Major Update:** 2026-07-02 (added accountant-friendly UI principles, commit-list + recent-states patterns, 12 UI propositions)

---

## 1. The Core Idea

entrytwo treats the entire set of accounting records as a **Git repository of financial truth**.

- Every change is a **commit**.
- History is immutable and fully auditable.
- You can **branch** to explore "what if" scenarios or let the AI work in parallel.
- You can **merge** proposals into the main line of truth.
- You can **tag** important states (month-end close, "ready for tax filing", "auditor snapshot").
- You can **diff**, **blame**, **revert**, and **restore** to any previous point.
- The AI is a **first-class contributor** that can create commits autonomously when its confidence is high, exactly like a senior team member with good track record.

This is not "AI helps with suggestions while humans do the real work."  
This is: **The boring, repetitive, error-prone class of bookkeeping work is done by AI. Humans provide high-level direction, review exceptions, and own the outcome.**

The goal is simple: **You should not need to hire a bookkeeping accountant to keep the books correct.**

---

## 2. Exact Git-to-Accounting Mapping

| Git Concept              | Accounting Equivalent                                      | Notes |
|--------------------------|------------------------------------------------------------|-------|
| Commit                   | Journal Entry (immutable once created)                     | Full payload + rich metadata |
| Commit message + author  | Description + `createdBy` (human or "AI:<model>") + reasoning | Every commit explains *why* |
| Branch                   | Parallel view of reality (e.g. "AI-reconciliation-june", "what-if-vat-rate-change") | Can be merged or discarded |
| Merge                    | Accepting a set of entries/proposals into the main books   | Can be manual or auto at high confidence |
| Tag / Release            | Period close, signed financials, tax filing version        | Immutable marker of "this was the official state" |
| Diff                     | "What changed between two dates / states / branches"       | Essential for auditors and explanations |
| Blame                    | "Who (or what AI) touched this account and why"            | Line-level or account-level history |
| Revert / Cherry-pick     | Reversing entry or selective application of past changes   | Always creates new commits (never rewrites history) |
| Reflog / History         | Complete Event log + ability to walk the full timeline     | "Show me everything that happened" |
| Push / Pull (conceptual) | Sync with external systems or other branches               | Future: multi-device, multi-user, external feeds |
| PR / Code Review         | AI proposes entries on a branch → review & merge           | High-confidence proposals can auto-merge |

**Key rule:** History is **never rewritten**. All changes (including rollbacks and AI actions) are new commits that reference the past.

### 2.1 Accountant-Friendly Commit History and Navigation

Although we use exact Git terms (commit, branch, merge, tag, restore, head), the daily experience must feel natural for accountants, not developers.

Familiar patterns that work well:
- A **commit list** (like GitHub `/commits/main`) shows recent commits in reverse chronological order. Each row shows date, description, author (human or "AI:claude-..."), and a stable identifier (event id or short SHA). Clicking a commit shows exactly what changed (the journal lines or net effect).
- A lightweight **recent-states selector** (like v0.app version dropdown) lists the last N commits or tagged states. Picking one loads that point-in-time view (branch + asOf) across the entire app. "Restore this state" moves the branch head.
- **Restore** always creates a new `ROLLBACK` commit. It does not delete or rewrite anything. You can immediately restore to any other point, including the state before the previous restore. This is the accounting-safe equivalent of "go back to an earlier version."

These surfaces become the primary way accountants browse and recover history. Raw event ids and advanced tools (diff, blame) remain available but are not required for normal use.

Persistent view state must always be visible: "Viewing: main (current books)" or "Viewing: ai-june-recon • as of June close (tagged)".

---

## 2.2 Accountant-Friendly Git UI Principles

The 12 core principles for making the Git model usable by accountants (exact Git terms are kept; explanations and labels are written for finance users):

1. **Persistent "Books View" indicator** — always know what books you are looking at (branch + point-in-time or tag).
2. **Dedicated History area** — move complex Git controls out of the main dashboard into a calm "History" section or panel.
3. **Simple branch list with accountant framing** — "main = official books (protected)", other branches = "working area / AI experiment".
4. **Date-focused point-in-time + recent states dropdown** — prefer human dates and named tags over raw event ids.
5. **Tags as first-class "bookmarked states"** — month-end close, auditor snapshot, tax filing version.
6. **Restore as "Time travel / Revert view" with mandatory preview** — always show balance impact table first. Clear language about new rollback commit.
7. **Merge as deliberate "Accept work into main"** — only offered when viewing a non-main branch; show net changes before confirming.
8. **Diff and Blame as context tools** — surfaced from ledger/journal/account, not as top-level scary buttons.
9. **Audit log as visible history surface** — highlight Git events (BRANCH_CREATED, MERGE, ROLLBACK, TAG_CREATED, AI_AUTONOMOUS_ENTRY).
10. **Contextual state in every panel** — subtle badges in Accounts, Journal, Ledger, Reports: "as of [date/branch]".
11. **Strong safety & mental model helpers** — banners for non-main views, chat lock respected, preview-first for head-moving actions.
12. **Workflow-oriented defaults** — suggest branching before risky work, make "tag current view" prominent for closes.

These principles must guide all future UI work on the Git model.

---



## 3. AI as a First-Class Citizen (Autonomous at High Confidence)

The AI (via chat and background agents) is allowed — and expected — to:

- Create journal entries autonomously when confidence is high (e.g. > 0.85 + strong feed match + learned merchant pattern + no ambiguity).
- Perform reconciliation across accounts ("reconcile all bank accounts for June").
- Explain discrepancies ("why is the 1000 account not zero?").
- Propose fixes as draft entries or on a branch.
- Execute point-in-time restores when explicitly instructed ("restore the books to 2026-06-15 14:30").

**Confidence & Autonomy Rules (must be implemented and respected):**
- **High confidence**: AI creates the entry(ies) directly on main (or auto-merges its branch). Full reasoning is recorded.
- **Medium confidence**: AI creates on a named branch/proposal and waits for human merge.
- **Low confidence or high-risk** (tax changes, large amounts, new jurisdictions): Always propose only. Never auto-apply.
- Every autonomous action is logged with model, prompt context, confidence score, sources used, and the exact entries created.
- The user can always override, review, or roll back.

The chat is the primary interface for giving the AI these instructions:
- "Reconcile the 1100 account for last month and explain anything that didn't match."
- "Why is there a $47.22 difference in cash?"
- "Restore the entire system to the state right after the June close."

---

## 4. Reconciliation Philosophy

**There is only one truth.**

Classical manual reconciliation and "AI reconciliation" are not two different things. When the AI reconciles accounts:

- It analyzes feeds, existing journal lines, timing differences, learned patterns, etc.
- It clears items (marks them as reconciled).
- It proposes or creates the necessary adjusting entries.
- The **output** is a classical-looking reconciliation report:
  - Starting balance
  - Cleared items
  - Outstanding / uncleared items
  - Adjustments made
  - Ending balance matches the statement
  - Full provenance (what the AI did + why + confidence)

The report an auditor or bank expects is exactly this artifact — whether a human or the AI produced it.

We still produce the "classical" report format. We just stop pretending that a human must manually tick every box for it to be valid.

---

## 5. Rollback, Time Travel, and Safety (GitHub-Style)

The system must support full Git-like safety:

- Create a branch before any risky AI work.
- Experiment freely.
- Merge only what you like.
- Tag stable points ("pre-reconciliation", "month-end-signed").
- Restore the entire books (or specific accounts) to any previous commit / snapshot / date.
- See a clean diff of what a rollback would do before executing it.
- Every rollback itself creates an auditable event + new commits (reversing or replaying as needed).

Implementation foundation (already partially described in older docs):
- `Event` table = full commit log.
- `Snapshot` table = periodic full state captures (for fast restore).
- Replay engine: given a snapshot + events up to a point → reconstruct exact state.
- Branches: lightweight pointers into the event history (or explicit branch metadata).

Rollback is **not** "delete history". It is "move the head to a previous point" while preserving everything that happened (exactly like `git reset` or `git revert` with full reflog).

**Friendly restore pattern (required):**  
Accountants must be able to browse recent commits (GitHub-style list) or pick from a simple recent-states dropdown, preview the effect, and restore. Restore always creates a new audited `ROLLBACK` commit. The user can immediately choose any earlier point again, including the state before the restore. "Restore makes this the current main" is allowed on the main branch but is always a new commit — history is never lost.

---



## 6. Why This Satisfies Even the Most Detail-Oriented Auditor

A traditional accounting system gives auditors:
- A list of entries
- Some change logs
- Hope that nothing was edited after the fact

A Git-model system gives them:
- Immutable, timestamped, attributable commits for every single change.
- Complete `git log` style history with full context and AI reasoning attached.
- `blame` on every account and line.
- Exact diffs between any two points in time.
- Signed/tagged states that represent "this is what we closed the books on".
- Ability to see exactly what the AI did and why (with sources).
- Safe, auditable rollback that doesn't destroy evidence.

This is **better** auditability than almost every traditional accounting package. Done right, it would satisfy the strictest auditor or tax authority that cares about provenance and immutability.

---

## 7. The Product Goal (Never Lose Sight of This)

The entire reason for this model is:

> Make accounting easy enough that a normal business owner or operator can keep proper books without hiring a full-time bookkeeper or accountant for the drudgery.

- AI does the matching, explaining, proposing, and high-confidence committing.
- Humans give direction ("reconcile June", "why is this off?", "close the month") and review the important stuff.
- The system remains fully auditable, reversible, and produces all the official artifacts anyone needs.

If we ever build features that force the user back into manual ticking and drudgery "because that's how accounting has always been done", we are failing the mission.

---

## 8. Non-Negotiables (This Document Is Authoritative)

- All new features, UI changes, AI behavior, and reports must be designed through the lens of this Git model.
- History is sacred. Never silently mutate or delete past events.
- AI autonomy at high confidence is a deliberate, supported feature — not a future "maybe".
- Reconciliation is an AI-first process whose output is the classical report.
- Rollback / branching / diff / blame must exist and be usable from both UI and chat.
- This philosophy must be referenced in `production-ready.md`, implementation plans, architecture docs, and onboarding materials.
- If any document or code contradicts this model, the Git model wins and the other artifact must be updated.

---

## 9. Related Documents (Must Stay Consistent)

- `docs/production-ready.md` — must treat this as the guiding philosophy.
- `docs/Detailed-Data-Model-Prisma-Schema.md` — event sourcing + snapshots were always meant for this.
- `docs/Project-Scope-Architecture.md`
- `docs/Technical-Architecture.md`
- `docs/PRODUCTION-READINESS-PLAN.md`
- `docs/Implementation-Plan.md`
- Any future design docs.

This document is the **north star**. Everything else derives from it.

---

**If you are reading this in the future and considering changing direction away from the Git model for accounting, stop. Re-read the product goal above. Then come back and explain why the new direction is better at eliminating bookkeeping drudgery while preserving (or improving) auditability. Chances are it isn't.**

This model is what makes entrytwo different and actually useful.
