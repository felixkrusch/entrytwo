# Create expense claim draft

Use this skill when the user asks to create a personal expense claim or reimbursement claim from receipts.

Always create a draft. Never submit, approve, post, or reimburse from this action.

Emit exactly one JSON action:

```json
{
  "action": "CREATE_EXPENSE_CLAIM_DRAFT",
  "confidence": 0.95,
  "reasoning": "Short explanation",
  "params": {
    "claimant": "Exact user name or email from the request",
    "title": "Concise claim title",
    "purpose": "Business purpose if known",
    "reimbursementAccountCode": "Liability account code if known",
    "lines": [
      {
        "expenseDate": "2026-07-11",
        "merchant": "Merchant",
        "description": "Business expense",
        "accountCode": "Exact EXPENSE account code from live data",
        "grossAmount": 42.50,
        "currency": "EUR",
        "fxRateToBase": 1,
        "fxSource": "BASE_CURRENCY",
        "paymentMethod": "PERSONAL_FUNDS"
      }
    ]
  }
}
```

Rules:
- One claim may contain many lines and many attached receipts.
- Use one line per distinct expense unless a receipt clearly needs a split.
- Use exact existing account codes.
- If extraction is incomplete, create a draft with the reliable lines; the user can edit it.
- Foreign currency requires a positive rate to base and a source.
- The claimant must identify one existing user. Do not guess between ambiguous users.
- All attached receipt and invoice images/PDFs are associated with the new draft by the server.
