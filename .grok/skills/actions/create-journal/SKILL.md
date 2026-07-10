# CREATE_JOURNAL skill

Use this when the user wants to record a journal entry.

## Exact shape

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
  "reasoning": "Brief explanation of why this action and these values."
}
```

## Variants

### Foreign currency + FX rate (required when currency != base)

**Rule:** For new foreign-currency lines, fxSource must be:
- "BANK_FEED:..." only when the rate truly came from a live statement/feed in this turn.
- Otherwise call `get_provisional_fx_rate` for the currency and transaction date, then use its exact `fxRateToBase`, `fxSource`, and `date`.
- Never omit the rate, invent it, or let a foreign amount fall back to 1:1. If no quote is available, do not emit the action.

Example of a new entry with provisional rate:

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "X.AI subscription",
    "date": "2026-07-10",
    "lines": [
      { "accountCode": "5200", "debit": 30, "credit": 0, "currency": "USD", "fxRateToBase": 0.92, "fxSource": "ECB_PROVISIONAL", "fxDate": "2026-07-10", "description": "AI services" },
      { "accountCode": "2100", "debit": 0, "credit": 27.6, "currency": "EUR", "description": "Card liability (provisional)" }
    ]
  }
}
```

### FX adjustment entry (when statement arrives for prior provisional bookings)

When a statement reveals the real rate/fees for a previously provisional foreign purchase, emit a **small adjustment** (do not touch the original entry):

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "FX + fee adjustment for JE-2026-0042 - X.AI $30",
    "date": "2026-07-15",
    "lines": [
      { "accountCode": "5200", "debit": 0.50, "credit": 0, "currency": "EUR", "description": "X.AI - FX difference from provisional" },
      { "accountCode": "6990", "debit": 1.00, "credit": 0, "currency": "EUR", "description": "X.AI - foreign transaction fee" },
      { "accountCode": "2100", "debit": 0, "credit": 1.50, "currency": "EUR", "description": "Adjustment to card liability (BANK_FEED)" }
    ]
  }
}
```

Use the authoritative BANK_FEED fxSource on the adjustment lines. Reference the original entry number.

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

## Strict rules

- At least 2 lines.
- Sum of debits == sum of credits (after converting any FX lines to base currency).
- Use real `accountCode` values from the live ledger state shown this turn.
- `taxRateId` and `contactId` are optional; when used they must be valid (server will resolve or error).
- `fxRateToBase` is required for any line whose currency != base currency.
- `fxSource` and `fxDate` should be included when you have them (bank feed > user > AI estimate).
- `branch` and `asOf` are usually omitted (server uses current view).

Output exactly one CREATE_JOURNAL object after studying this skill.
