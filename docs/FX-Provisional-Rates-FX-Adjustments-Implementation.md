# FX Provisional Rates + FX Adjustment Entries — Full Implementation Plan

**Status:** Authoritative design + implementation spec  
**Date:** 2026-07-10  
**Owner:** Kilo + human review  
**Related:** Git-Model-for-Accounting.md, Statement-Uploads-BANK_FEED-Sources.md, Stripe-PayPal-Bank-Feeds.md

## 1. Problem Statement (recap)

- Foreign-currency expenses are often recorded on the **purchase / invoice date** (Day 0).
- The real bank/credit-card statement (with actual FX rate + fees) arrives 7–30 days later.
- Current code eagerly attaches rates:
  - NewJournalEntryModal auto-calls `/api/fx` on open and stamps ECB/LOOKUP.
  - `journal-entries` POST derives rates from balancing lines (`DERIVED_FROM_ENTRY`).
  - Prompt injection + `findRecentBankFeedRateForMerchant` lets the model reuse old `BANK_FEED` rates for new merchants.
  - Autonomous `CREATE_JOURNAL` can emit `AI_AUTONOMOUS` or remembered rates.
- Result: entries appear with `fxSource` that looks authoritative (or is silently derived) long before the real feed data exists.
- Display bug example: `$30` shown as `-€30.00 → €27.60`.
- Compliance / Git model requirement: once posted, a journal entry is **immutable**. Corrections must be new entries (reversals or adjustments), never in-place edits.

## 2. Chosen Solution: Provisional Rates + Small FX Adjustment Entries

This is the standard accounting treatment:
- Record on transaction date using a clearly **provisional** rate (ECB daily or user estimate).
- Mark it explicitly so everyone (UI, reports, AI, auditors) knows it is not final.
- When the real statement/feed arrives, post a **small FX adjustment entry** (difference + explicit fees).
- Original entry date and amounts stay untouched (perfect for Git ancestry and audit trail).
- Net P&L and balance sheet become correct as of the statement date.

### Why not the alternatives
- Block entry until rate known → users work around it or stop recording foreign expenses.
- Leave amounts unknown until statement → reports, budgeting, tax estimates are broken for weeks.
- Update original in place → violates immutable Git model + creates audit nightmares.
- Reverse + full repost → noisy history, confusing for users.

## 3. fxSource Taxonomy (Convention, not DB enum)

`fxSource` remains a free `String?` column. We use well-known prefixes and values:

**Authoritative (BANK_FEED family — these win, are "the truth")**
- `BANK_FEED:statement:visa-1234-2026-06`
- `BANK_FEED:stripe:pi_...`
- `BANK_FEED:paypal:...`
- Any string starting with `BANK_FEED`

**Provisional family (explicitly not final)**
- `PROVISIONAL`
- `ECB_PROVISIONAL`
- `MANUAL_PROVISIONAL`
- (Legacy weak ones that should be treated as provisional: `AI_AUTONOMOUS`, `DERIVED_FROM_ENTRY`, `AI_REMEMBERED`, `ECB`, `MANUAL` when no user intent to lock)

**Explicit user choice**
- `MANUAL` (user typed a specific rate and intends it to be final for now)

**Internal / legacy**
- `DERIVED_FROM_ENTRY` (only created by server derivation logic — we will deprecate for foreign lines)
- `AI_AUTONOMOUS`

Helper functions (new, in `lib/fx.ts` or a new `lib/fxSources.ts`):
```ts
export function isAuthoritativeBankFeed(src?: string | null): boolean
export function isProvisional(src?: string | null): boolean
export function getFxCategory(src?: string | null): 'BANK_FEED' | 'PROVISIONAL' | 'MANUAL' | 'WEAK'
export function normalizeProvisional(src?: string | null): string
```

UI rule:
- Green "feed" badge + "fx 0.xxxx" only when `isAuthoritativeBankFeed(src)`.
- Amber/warning badge + "provisional" or "estimated" for everything else.

## 4. No Schema Change Required

`JournalLine.fxSource` + `fxRateToBase` + `fxDate` + `currency` are sufficient.

We may later add a boolean `isFxProvisional` for fast queries, but it is **not** required for this implementation. String convention + helpers are enough.

Existing data with old values (`ECB`, `MANUAL`, `AI_AUTONOMOUS`, `DERIVED_FROM_ENTRY`) will be treated as provisional by the new helpers.

## 5. Core Behavioral Changes

### 5.1 NewJournalEntryModal (stop eager stamping)
- Remove the `useEffect` that auto-fetches `/api/fx` for every foreign line on open.
- Replace with three explicit user choices (radio or clear buttons):
  1. "Use estimated ECB rate (provisional)"
  2. "Enter my own rate (I know it)"
  3. "Leave rate pending (no base-currency conversion yet)"
- Default: option 3 or 1 with prominent warning.
- When a suggestion already carries a real `BANK_FEED:...` rate, pre-select it and show the authoritative badge. Do not overwrite.
- On save, if user chose provisional ECB, call the lookup and set `fxSource: 'ECB_PROVISIONAL'`.
- If user chose "pending", leave `fxRateToBase: null` and `fxSource: 'PROVISIONAL'`.

### 5.2 journal-entries POST (stop derivation for foreign)
- Remove or condition the block at ~lines 209-232 that derives `fxRateToBase` from balancing lines for foreign currency.
- Only derive if the user explicitly supplied matching base amounts intending to lock the rate (rare, and we can require an extra flag later if needed).
- If a foreign line arrives without a good rate + authoritative source → force `fxSource = 'PROVISIONAL'` (or 'ECB_PROVISIONAL' if we just looked one up).
- Optionally append a note to `description` or add a line-level note.

### 5.3 Autonomous / Chat CREATE_JOURNAL path
- `app/api/chat/route.ts`:
  - In the `CREATE_JOURNAL` block: if any line has `currency != base` and no `fxSource` starting with `BANK_FEED`, force `fxSource = 'PROVISIONAL'` (or keep `AI_AUTONOMOUS` but treat it as provisional semantically).
  - Never allow the model to emit `BANK_FEED` unless the rate came from a statement/feed attachment in the current turn.
  - In the text response: explicitly say "Recorded using provisional rate. See Pending FX items."
- `lib/chat/validation.ts`: allow `fxRateToBase: null` for foreign lines; mark source as provisional when missing.
- `lib/accounting/autonomous.ts`: same rule as chat route.
- Update system prompt in `buildMasterSystemPrompt` and the injected "Recent real bank/card feed rates" text to say these are reference only. New entries must use `PROVISIONAL` unless the rate was supplied by the statement in this turn.

### 5.4 Prompt injection & memory (recentFeedRates, feedRatesForChat, feedMatching)
- `lib/recentFeedRates.ts` + `lib/feedRatesForChat.ts`: label injected text as "Historical realized rates from past statements (reference only)".
- `lib/feedMatching.ts` (`findRecentBankFeedRateForMerchant`):
  - Make matching much stricter (exact card/account when known + tighter date window ±2 days preferred).
  - Always return with a flag "treatAsProvisional: true" for new entries.
  - Never let callers attach the returned rate with a `BANK_FEED` source unless it is actually from the current statement context.

### 5.5 Statement upload skills (critical — LLM must create FX adjustments)
The LLM is the best place to see both the new statement lines *and* prior provisional entries.

Update these files:

- `.grok/skills/actions/extract-bank-statement/SKILL.md`
  - Add strong new section "Provisional entries + FX adjustments".
  - Instruct the model: when processing a statement, look for prior provisional journal lines (merchant, foreign amount, date), and emit small adjustment `CREATE_JOURNAL` actions that correct to the real statement rate + fees.
  - Provide example adjustment JSON.
  - Rule: never mutate or reverse the original provisional entry.
  - Rule: use the authoritative `BANK_FEED:statement:...` source only on the adjustment (and on new lines from this statement).

- `.grok/skills/actions/create-journal/SKILL.md`
  - Add a short "FX adjustment variant" example.
  - Clarify that `fxSource` on adjustment lines must be the current authoritative feed.

- `.grok/skills/actions/core-principles/SKILL.md`
  - Add one bullet about emitting FX adjustments for prior provisionals.

Also update supporting docs:
- `docs/Statement-Uploads-BANK_FEED-Sources.md` (add a paragraph in the guardrails and normalized shape sections).

### 5.6 Server-side adjustment proposal (defense in depth)
- In QuickFeedImport, `/api/feeds/import`, bank-feeds match route, and postFeedAsJournal:
  - After creating authoritative lines, run a lookup for prior provisional lines (same merchant fuzzy + currency + amount window).
  - If found, create (or propose at lower confidence) a small FX adjustment entry.
  - The adjustment uses the exact base amount that hit the card/bank from the feed when available.

### 5.7 Pending FX queue + visibility
- New component (or section): `app/app/PendingFxItems.tsx` (or integrated into JournalEntriesPanel as a filter tab "Pending FX").
- Query: all `JournalLine` where `currency != 'EUR'`, `fxRateToBase != null` or `fxSource` indicates provisional, and `!isAuthoritativeBankFeed(fxSource)`.
- Show: date, description, foreign amount + currency, provisional rate used, estimated EUR, days outstanding, original entry link.
- Actions:
  - "Create FX adjustment now" (opens NewJournalEntryModal pre-filled with difference).
  - "Confirm current rate as final" (changes source to `MANUAL` — still not BANK_FEED, but user intent).
  - "Match to statement line" (future).
- Dashboard widget (light version): count of pending items + link.
- Badges in JournalEntriesPanel and LedgerView:
  - Authoritative: green "feed" + exact rate.
  - Provisional: amber "provisional" or "estimated (ECB)".

### 5.8 Display fixes (the immediate user complaint)
- In `JournalEntriesPanel.tsx` (and LedgerView where similar):
  - When showing FX conversion, always display the **original currency symbol** on the left side of the arrow:
    - `$30.00 → €27.60`
  - Never render the foreign amount as if it were EUR.
  - Use `format.number(..., { style: 'currency', currency: line.currency })` for the foreign side.

## 6. Adjustment Entry Contract (standard pattern)

Typical FX + fee adjustment (minimal, 2–4 lines):

```
Debit  Expense (or original account)          0.50   EUR   "X.AI - FX diff from provisional 0.92"
Debit  FX / Card fees account                 1.00   EUR   "X.AI - foreign transaction fee"
Credit Card liability / clearing             1.50   EUR   "Adjustment for JE-2026-0042"
```

- Description must reference the original entry number or merchant + amount.
- `fxSource` on any line that carries FX must be the current authoritative `BANK_FEED:...`.
- The adjustment is dated on the statement posting/settlement date.
- Net effect: expense is now at the real economic cost; FX gain/loss and fees are isolated for analysis.

## 7. Implementation Order (do not skip)

High priority (these fix the root causes):
1. fxSource helper functions (`lib/fx.ts` or new `lib/fxSources.ts`).
2. NewJournalEntryModal — remove auto-fetch, add explicit choices, provisional marking.
3. journal-entries POST — stop derivation for foreign, force PROVISIONAL.
4. chat route + autonomous + validation — force PROVISIONAL, update prompts.
5. recentFeedRates / feedRatesForChat / feedMatching — label as reference, stricter matching.
6. Update the three skill files + core principles.
7. Display fix in JournalEntriesPanel (currency on left of arrow).

Medium (make the workflow visible and complete):
8. Pending FX queue component + integration (list + actions).
9. Badges everywhere (JournalEntriesPanel, Ledger, modal).
10. Server-side adjustment proposal in feed import paths.
11. Update supporting docs.

12. Add / update tests (vitest) for the new helpers, creation rules, and adjustment logic.
13. Run full `npm run build`, `npm run lint`, `npm test`.

## 8. Testing Requirements (must pass before considered done)

- Unit tests for new fxSource helpers.
- Tests that NewJournalEntryModal does not auto-stamp on foreign lines.
- Tests / integration that journal-entries POST leaves foreign lines as PROVISIONAL when no good source.
- Chat/autonomous path test: foreign line without BANK_FEED in action → source is provisional.
- Statement skill examples must be valid JSON and follow the new rules (can be manual review + a smoke test).
- End-to-end manual scenario:
  1. Create foreign expense via modal or chat → see provisional badge + warning.
  2. Later "upload" a statement (or use QuickFeedImport) for same merchant → adjustment entry is proposed/created.
  3. Ledger shows original untouched + adjustment. Net correct.
- Build succeeds with zero new errors.
- Existing reversal, ancestry, and Git model tests still green.

## 9. Backwards Compatibility & Migration

- All existing lines keep their current `fxSource` values.
- New helpers treat old `ECB`, `MANUAL`, `AI_AUTONOMOUS`, `DERIVED_FROM_ENTRY` as provisional.
- No data migration script required for v1 of this feature.
- Optional later: a one-time script to backfill `fxSource = 'ECB_PROVISIONAL'` for lines that currently have `fxSource = 'ECB'`.

## 10. Files Expected to Change

**New**
- `docs/FX-Provisional-Rates-FX-Adjustments-Implementation.md` (this document)
- `lib/fxSources.ts` (or additions to `lib/fx.ts`)
- `app/app/PendingFxItems.tsx` (or section inside JournalEntriesPanel)
- Possibly `app/app/FxAdjustmentModal.tsx` (or reuse NewJournalEntryModal with prefill)

**Modified**
- `.grok/skills/actions/extract-bank-statement/SKILL.md`
- `.grok/skills/actions/create-journal/SKILL.md`
- `.grok/skills/actions/core-principles/SKILL.md`
- `app/app/NewJournalEntryModal.tsx`
- `app/api/journal-entries/route.ts`
- `app/api/chat/route.ts`
- `lib/chat/validation.ts`
- `lib/accounting/autonomous.ts`
- `lib/feedMatching.ts`
- `lib/recentFeedRates.ts`
- `lib/feedRatesForChat.ts`
- `app/app/JournalEntriesPanel.tsx`
- `app/app/LedgerView.tsx`
- `docs/Statement-Uploads-BANK_FEED-Sources.md`
- Various test files if they assert old behavior

## 11. Success Criteria (definition of "100% done")

- Every foreign-currency journal line created after this change is either:
  - Marked with an authoritative `BANK_FEED:...` source (only when the rate truly came from a feed/statement in context), **or**
  - Explicitly marked provisional (`PROVISIONAL`, `ECB_PROVISIONAL`, `MANUAL_PROVISIONAL`, or legacy weak sources treated as such).
- No code path auto-attaches a rate without user or statement intent.
- When a statement is processed, the LLM (via updated skill) and/or server logic proposes or creates small FX adjustment entries.
- UI makes the provisional state obvious and provides a clear path to resolution.
- All tests, lint, and build are green.
- The original user complaint ("$30 shown as -€30.00") is fixed.

---

This document is the single source of truth for the feature. Implementation must follow it without shortcuts.
