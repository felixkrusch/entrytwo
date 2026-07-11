# EXTRACT_BANK_STATEMENT skill

Use this when the user provides a bank or credit card **statement** (PDF upload or pasted HTML/text table from the bank website) and wants to turn it into journal entries.

This is the primary path for credit cards (Visa, Mastercard, etc.) and most general bank statements.

## Goal
Turn messy statement data (PDF or HTML paste) into one `CREATE_JOURNAL_BATCH` action containing **exactly one balanced journal entry per statement transaction**.

## When to call this skill
- User uploads a PDF bank/credit card statement.
- User pastes an HTML table or text from a bank portal ("transactions this month").
- User says things like: "process my Visa statement", "here is the Mastercard for June", "extract these transactions".

## Exact output shape after studying this skill
First call the skill, then emit exactly one `CREATE_JOURNAL_BATCH` JSON action. Never combine multiple statement transactions into one entry.

```json
{
  "action": "CREATE_JOURNAL_BATCH",
  "params": {
    "sourcePdfPath": "/uploads/receipts/2026-...-statement.pdf",
    "entries": [{
      "description": "Office supplies - ACME",
      "date": "2026-06-12",
      "lines": [
      {
        "accountCode": "2100",
        "debit": 0,
        "credit": 84.50,
        "description": "Visa liability",
        "currency": "EUR"
      },
      {
        "accountCode": "5200",
        "debit": 84.50,
        "credit": 0,
        "description": "Office supplies - ACME",
        "currency": "EUR"
      }
      ]
    }]
  },
  "confidence": 0.92,
  "reasoning": "Extracted from pasted Visa HTML table + PDF. FX rate taken from statement where shown."
}
```

## Critical rules for statement extraction

### 1. FX rates from the statement are authoritative
- If the statement (PDF or table) explicitly shows a rate or conversion (e.g. "1.0872", "USD 100 @ 0.92"), capture it.
- Always set:
  - `fxSource`: `"BANK_FEED:statement:visa-..."` or `"mastercard-..."` or bank name
  - `fxRateToBase`
  - `fxDate`
- Prefer the rate **shown on this document** over every provisional estimate.

### 2. Fees must be explicit
- Foreign transaction or conversion fee tied to a purchase → separate line in that transaction's entry.
- Standalone annual/service fee → its own journal entry because it is its own statement transaction.
- Do not bury fees inside the merchant amount.

### 3. Separate the "big payment" from merchant transactions
- When the user pays the card issuer (or bank), create a distinct entry or clear line.
- Do **not** mix it with individual merchant charges.

### 4. Preserve provenance
- If a PDF was attached this turn, set `sourcePdfPath`.
- For pasted HTML, include a clear description like "extracted from pasted HTML table 2026-07-09".
- The resulting journal entry must be traceable back to this statement.

### 5. Date handling
- Use the **transaction date** from the statement when available.
- Every entry in `entries` uses that transaction's date, not the statement period end date.

### 6. Multi-currency
- Record original merchant currency + amount when shown.
- Always provide `fxRateToBase` on the line that differs from base currency.
- If the statement shows only original and billed amounts, derive `fxRateToBase = billed base amount / original foreign amount` and mark it with the statement BANK_FEED source.
- If no statement conversion exists, use `web_search` and compare at least two independent sources; never assume 1:1.

### 7. Use real account codes
- Only use codes that exist in the live balances shown this turn.
- Common patterns:
  - Credit card liability / clearing: 2100 or similar
  - Bank account: 1010, 1000, etc.
  - Expense categories based on merchant (ask user only if truly ambiguous)

### 8. One transaction = one entry
- Count all transaction rows, including purchases, refunds, payments, and standalone fees.
- `params.entries.length` must equal that transaction count.
- Each entry must balance independently in base currency. Never create one aggregate statement journal.
- Output one top-level `CREATE_JOURNAL_BATCH` action only.

### 9. Provisional entries + FX adjustments (when real statement arrives later)
Most foreign-currency purchases are first recorded on the transaction/invoice date using a clearly marked **provisional** rate:
- fxSource is not authoritative unless it starts with `BANK_FEED`; all LLM/manual/legacy estimates remain provisional.
- These are NOT authoritative.

When you receive a bank/credit card statement (PDF or pasted HTML):
- Scan the live ledger context for prior journal lines that have the same or very similar merchant, same foreign currency, and a date within a few days.
- For every such match:
  - Add a **small FX adjustment entry** (2-4 lines) to the batch, dated on the statement posting/settlement date.
  - Use the **authoritative** rate and exact base amount from the current statement (fxSource must start with "BANK_FEED:statement:..." or the processor equivalent).
  - The adjustment records only the *difference* + any explicit fees.
  - Description must reference the original entry, e.g. "FX + fee adjustment for JE-2026-0042 - X.AI $30".
  - Do NOT reverse or modify the original provisional entry in any way.
  - Typical pattern (example):
    Debit  Expense (or original account)   <small positive or negative difference> EUR
    Debit  FX / Card fees account          <fee amount> EUR
    Credit Card liability / clearing       <total delta> EUR
- If the statement gives the exact charged base-currency amount, prefer that over foreignAmount × rate.
- Output one entry per authoritative statement transaction, plus adjustment entries only when correcting separately recorded provisional purchases.
- In the chat response text, mention that provisional entries were corrected via small adjustment(s).

Rules:
- Never attach a BANK_FEED fxSource to the original provisional lines.
- Only use BANK_FEED fxSource on lines that come from this statement or the adjustment derived from it.
- If you are unsure which original entry to reference, still create the adjustment using merchant + foreign amount in the description.

## Examples of good behavior

**Pasted HTML table with FX:**
- Extract each line.
- Pull rate shown on the statement.
- Mark `fxSource: "BANK_FEED:statement:mastercard-..."`.
- Create explicit fee line if present.

**PDF statement with annual fee + big payment:**
- Extract all merchant charges.
- Separate annual fee line.
- Separate the large credit "Payment Received - Card Issuer".

## What NOT to do
- Do not invent FX rates.
- Do not collapse fees into merchant amounts.
- Do not treat the card payment as just another merchant credit.
- Do not guess account codes that are not in the current live state.

After studying this skill, emit one clean `CREATE_JOURNAL_BATCH` JSON action.

Output exactly one action object.
