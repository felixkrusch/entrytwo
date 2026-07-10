# EXTRACT_BANK_STATEMENT skill

Use this when the user provides a bank or credit card **statement** (PDF upload or pasted HTML/text table from the bank website) and wants to turn it into journal entries.

This is the primary path for credit cards (Visa, Mastercard, etc.) and most general bank statements.

## Goal
Turn messy statement data (PDF or HTML paste) into one or more clean, balanced `CREATE_JOURNAL` actions with **authoritative BANK_FEED FX rates**.

## When to call this skill
- User uploads a PDF bank/credit card statement.
- User pastes an HTML table or text from a bank portal ("transactions this month").
- User says things like: "process my Visa statement", "here is the Mastercard for June", "extract these transactions".

## Exact output shape after studying this skill
First call the skill, then emit **exactly one** JSON action (usually `CREATE_JOURNAL`, or multiple if you must).

```json
{
  "action": "CREATE_JOURNAL",
  "params": {
    "description": "Visa June 2026 statement",
    "date": "2026-06-30",
    "sourcePdfPath": "/uploads/receipts/2026-...-statement.pdf",
    "lines": [
      {
        "accountCode": "2100",
        "debit": 0,
        "credit": 84.50,
        "description": "Office supplies - ACME",
        "currency": "EUR",
        "fxRateToBase": null,
        "fxSource": "BANK_FEED:statement:visa-1234-2026-06",
        "fxDate": "2026-06-12"
      },
      {
        "accountCode": "5200",
        "debit": 84.50,
        "credit": 0,
        "description": "Office supplies - ACME",
        "currency": "EUR"
      }
    ]
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
- Prefer the rate **shown on this document** over previous feeds or ECB.

### 2. Fees must be explicit
- Foreign transaction fees, currency conversion fees, annual fees, etc. → separate lines.
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
- For the overall entry, you may use the statement period end date or the date of the payment line.
- Be consistent.

### 6. Multi-currency
- Record original merchant currency + amount when shown.
- Always provide `fxRateToBase` on the line that differs from base currency.

### 7. Use real account codes
- Only use codes that exist in the live balances shown this turn.
- Common patterns:
  - Credit card liability / clearing: 2100 or similar
  - Bank account: 1010, 1000, etc.
  - Expense categories based on merchant (ask user only if truly ambiguous)

### 8. Output exactly one action
- After reading this skill, output **one** clean `CREATE_JOURNAL` (or the appropriate action).
- Never output multiple top-level actions in one response.

### 9. Provisional entries + FX adjustments (when real statement arrives later)
Most foreign-currency purchases are first recorded on the transaction/invoice date using a clearly marked **provisional** rate:
- fxSource = "PROVISIONAL", "ECB_PROVISIONAL", "MANUAL_PROVISIONAL", "AI_AUTONOMOUS", "DERIVED_FROM_ENTRY", etc.
- These are NOT authoritative.

When you receive a bank/credit card statement (PDF or pasted HTML):
- Scan the live ledger context for prior journal lines that have the same or very similar merchant, same foreign currency, and a date within a few days.
- For every such match:
  - Create a **small FX adjustment entry** (2-4 lines) dated on the statement posting/settlement date.
  - Use the **authoritative** rate and exact base amount from the current statement (fxSource must start with "BANK_FEED:statement:..." or the processor equivalent).
  - The adjustment records only the *difference* + any explicit fees.
  - Description must reference the original entry, e.g. "FX + fee adjustment for JE-2026-0042 - X.AI $30".
  - Do NOT reverse or modify the original provisional entry in any way.
  - Typical pattern (example):
    Debit  Expense (or original account)   <small positive or negative difference> EUR
    Debit  FX / Card fees account          <fee amount> EUR
    Credit Card liability / clearing       <total delta> EUR
- If the statement gives the exact charged base-currency amount, prefer that over foreignAmount × rate.
- Output the authoritative statement lines (with proper BANK_FEED fxSource) AND the adjustment(s) as needed.
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

After studying this skill, look up `create-journal` if needed for the exact shape, then emit **one** clean JSON action.

Output exactly one action object.
