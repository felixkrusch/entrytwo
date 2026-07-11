# Core Principles (for Trillion actions)

**Study this when you decide to act.**

- Current view (branch + asOf) is always respected. All balances and accounts you see are for that view.
- Use **exact account codes** that exist in the live ledger state provided each turn.
- Journals must balance: sum(debits) == sum(credits) after FX to base currency.
- Prefer `accountCode` (string) over ids; server resolves.
- `branch` / `asOf` only if you want to override the current view (usually omit).
- For anything **not** this company's own data (general tax rates, laws, external FX) → use the internet / current sources. Do not guess.
- When chat is locked: you may still propose, the server will force `proposed: true`.

- FX provisional policy (critical):
  - Foreign purchases are normally first recorded with a sourced provisional quote and fxSource = LLM_PROVISIONAL:<source URLs> or MANUAL_PROVISIONAL.
  - If the current statement/feed does not show a rate, use `web_search` and compare at least two independent public sources for the transaction date or nearest prior market day before emitting the action.
  - Include the supporting source URLs in `fxSource` after `LLM_PROVISIONAL:`.
  - Never omit `fxRateToBase`, invent a rate, or use 1:1 for a foreign currency. If the lookup is unavailable, explain the blocker instead of creating the journal.
  - When processing a statement, look for prior provisional lines for the same merchants and emit small FX adjustment entries (difference + fees) using the authoritative BANK_FEED rate from the current statement.
  - Never mutate or reverse the original provisional entries.
  - Only emit fxSource starting with BANK_FEED when the rate came directly from the statement/feed in this turn.
- PROPOSE_* actions (destructive, master-data, etc.) are **never** autonomous — always require explicit user confirmation.

## What the server will do with your action JSON

1. Parse the first valid action object.
2. If locked or action is in PROPOSE list or destructive or validation fails → force proposal.
3. Run domain validation (balanced journal, accounts exist, contacts resolvable, etc.).
4. If validation fails → proposal with error.
5. Otherwise: either execute directly (Git commit) or return as proposal.
6. User can confirm later via `approvedAction`; server re-validates and executes.

Output **exactly one** clean JSON action (or ```json block). A statement uses one `CREATE_JOURNAL_BATCH` action containing multiple entries.

Normal questions → normal text. Real actions → look up the right skill → emit one JSON.
