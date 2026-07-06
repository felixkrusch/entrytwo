# LLM Action Reference for Trillion (entrytwo)

This is the authoritative reference for structured actions.

**Study this file when you need to create or change records.**

You must output **exactly one** clean JSON object (or a ```json fenced block) when acting.
The server will parse the first valid action object it finds, validate it, respect the chat lock, and either execute or turn it into a proposal.

Never output multiple actions in one response. Normal questions → normal helpful text.

Current view is always respected: branch + asOf (if pinned). All data you see (balances, accounts, etc.) is for that view.

---

## Core Principles

- Use **exact account codes** that exist in the current view's chart of accounts (see live ledger state provided in the prompt).
- Journals must balance (debits = credits) after FX conversion to base currency.
- Prefer `accountCode` (string) over ids in your output. The server resolves them.
- Include `branch` and `asOf` only if you want to override the current view (usually omit).
- For anything that is **not this company's own data** (general tax rates in a country, laws, external FX sources, etc.) → use the internet / current sources. Do not guess.
- When the chat is locked, you may still propose actions. The server will force `proposed: true`.

---

## CREATE_JOURNAL

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "Shareholder loan received",
    "date": "2026-07-06",
    "lines": [
      { "accountCode": "1000", "debit": 1000, "credit": 0, "description": "Cash received", "currency": "EUR" },
      { "accountCode": "2500", "debit": 0, "credit": 1000, "description": "Shareholder loan", "currency": "EUR" }
    ]
  },
  "confidence": 0.95,
  "reasoning": "User asked for a 1000 EUR shareholder loan posted to cash (1000) and loans payable (2500)."
}
```

### With foreign currency + FX rate

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "Invoice payment in USD",
    "date": "2026-07-05",
    "lines": [
      { "accountCode": "1000", "debit": 920, "credit": 0, "currency": "EUR", "description": "Bank receipt (USD converted)" },
      { "accountCode": "1100", "debit": 0, "credit": 1000, "currency": "USD", "fxRateToBase": 0.92, "fxSource": "bank", "fxDate": "2026-07-05", "description": "AR settlement" }
    ]
  }
}
```

### With tax and contact

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "Office supplies incl. VAT",
    "date": "2026-07-04",
    "lines": [
      { "accountCode": "5400", "debit": 84, "credit": 0, "description": "Supplies net", "taxRateId": "de-mwst-19" },
      { "accountCode": "1400", "debit": 16, "credit": 0, "description": "Input VAT 19%" },
      { "accountCode": "1000", "debit": 0, "credit": 100, "description": "Payment", "contactId": "..." }
    ]
  }
}
```

**Rules for journals**
- At least 2 lines.
- Sum of debits == sum of credits (after FX to base).
- Use real accountCodes from the live data shown to you.
- `taxRateId` and `contactId` are optional but must be valid when used (server resolves or errors).
- `fxRateToBase` is required when currency != base.

---

## CREATE_CONTACT

```json
{
  "action": "CREATE_CONTACT",
  "params": {
    "name": "Kaiser & Kaiser",
    "type": "CUSTOMER",
    "email": "info@kaiser.de",
    "addressStreet": "Marktstrasse 1",
    "addressCity": "Dillenburg",
    "addressZip": "35746",
    "addressCountry": "DE",
    "taxId": "DE123456789",
    "currency": "EUR"
  }
}
```

`type`: "CUSTOMER" | "VENDOR" (default CUSTOMER if omitted).

---

## UPDATE_CONTACT

```json
{
  "action": "UPDATE_CONTACT",
  "params": {
    "contactId": "c_abc123",
    "name": "Kaiser & Kaiser GmbH",
    "type": "CUSTOMER",
    "email": "billing@kaiser.de"
  }
}
```

Use either `contactId` or a unique `contactName` that the server can resolve.

---

## CREATE_INVOICE_DRAFT

```json
{
  "action": "CREATE_INVOICE_DRAFT",
  "params": {
    "contactName": "Kaiser & Kaiser",
    "description": "Consulting services July 2026",
    "currency": "EUR",
    "lines": [
      { "description": "Strategy workshop", "quantity": 1, "unitPrice": 2500, "taxRateId": "de-mwst-19" }
    ]
  }
}
```

- Requires a resolvable contact (by `contactId` or `contactName`).
- Lines are optional; if omitted a single line from `description` + `amount` is used.
- Drafts are created in DRAFT status.

---

## PROPOSE_* actions (always require explicit confirmation)

These are **never** executed autonomously:

- PROPOSE_RESTORE
- PROPOSE_MERGE
- PROPOSE_REVERSE
- PROPOSE_SEND_INVOICE
- PROPOSE_CHARGE
- PROPOSE_BULK_REVERSE
- PROPOSE_IMPORT_BACKUP
- PROPOSE_CREATE_ACCOUNT
- PROPOSE_UPDATE_TAX_RATE
- PROPOSE_UPDATE_SETTINGS
- PROPOSE_USER_CHANGE
- PROPOSE_TAG_CLOSE

Example:

```json
{
  "action": "PROPOSE_RESTORE",
  "params": { "target": "2026-06-15" }
}
```

```json
{
  "action": "PROPOSE_REVERSE",
  "params": { "originalId": "je_abc123" }
}
```

---

## Other actions (reference)

- APPLY_TEMPLATE
- MATCH_FEED_TRANSACTION
- SYNC_FEED
- IMPORT_FEED_CSV
- RECONCILE_ACCOUNT
- LEARN_MERCHANT
- OPEN_LEDGER
- GENERATE_RECURRING_DRAFT
- EXPLAIN

Most of these are thin wrappers. Use the same pattern:
```json
{ "action": "OPEN_LEDGER", "params": { "code": "1000" } }
```

---

## What the server will do with your action

1. Parse the JSON.
2. If chat is locked or action is in the PROPOSE list or destructive or low confidence → force proposal.
3. Run domain validation (balanced journal, accounts exist, contacts resolvable, etc.).
4. If validation fails → proposal with error.
5. Otherwise: either execute (Git commit on branch) or return as proposal.
6. On explicit user confirmation (approvedAction) the server re-validates and executes.

You do **not** need to decide "proposed" yourself. Just output the action you believe is correct.

---

## Good habits

- Look at the **live ledger state** provided in every turn for current balances and account codes.
- When the user corrects you ("I said customer", "no, use 2500"), use the full history — you see the previous turns.
- If something is ambiguous, ask in normal text instead of guessing an action.
- For worldwide tax questions or rules that are not specific to this company's configured rates, say you will check current sources.

This reference + the live data in the prompt + the full conversation history is everything you need to act correctly.
