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
- Otherwise use `web_search`. Compare at least two independent public sources for the transaction date or nearest prior market day. Use the supported provisional rate and include both source URLs in `fxSource` after `LLM_PROVISIONAL:`.
- Never omit the rate, invent it, or let a foreign amount fall back to 1:1. If no quote is available, do not emit the action.

Do not copy a rate or currency from an example. Read the configured base currency from the live company profile, use web search, and balance the other line using `foreign amount × sourced fxRateToBase`, rounded to base-currency cents.

If the user provides the base amount instead (for example, an original foreign amount and the actual card amount), preserve the original foreign amount and currency. Derive `fxRateToBase = base amount / foreign amount`, set `fxSource` to `MANUAL_PROVISIONAL`, and use the supplied base amount on the balancing line. Never flatten both lines into the base currency.

### FX adjustment entry (when statement arrives for prior provisional bookings)

When a statement reveals the real rate/fees for a previously provisional foreign purchase, emit a **small adjustment** (do not touch the original entry):

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "FX + fee adjustment for the referenced provisional entry",
    "date": "2026-07-15",
    "lines": [
      { "accountCode": "5200", "debit": 0.50, "credit": 0, "currency": "<configured base currency>", "description": "FX difference from provisional" },
      { "accountCode": "6990", "debit": 1.00, "credit": 0, "currency": "<configured base currency>", "description": "Foreign transaction fee" },
      { "accountCode": "2100", "debit": 0, "credit": 1.50, "currency": "<configured base currency>", "description": "Adjustment to card liability (BANK_FEED)" }
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
