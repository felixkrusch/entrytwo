# CREATE_INVOICE_DRAFT skill

Use when the user wants to create a draft invoice for a contact.

## Exact shape

```json
{
  "action": "CREATE_INVOICE_DRAFT",
  "params": {
    "contactName": "Kaiser & Kaiser",
    "description": "Consulting services July 2026",
    "currency": "EUR",
    "lines": [
      { "description": "Strategy workshop", "quantity": 1, "unitPrice": 2500, "taxRateId": "<exact UUID from the tax rates listed in the current live data>" }
    ]
  },
  "confidence": 0.9,
  "reasoning": "User asked to invoice the contact for the described work."
}
```

## Rules

- Requires a resolvable contact: prefer `contactId` if known, otherwise `contactName` (server will look it up).
- `lines` is an array of line items. If omitted or empty, the server may fall back to a single line using `description` + `amount`.
- `taxRateId` must be the exact UUID from the "Available tax rates" list provided in the live data this turn (e.g. a real id like "0198..."). Do not invent values like "de-mwst-19".
- `currency`: defaults to EUR.
- Draft invoices are created with status DRAFT.
- Do not use this for final sent invoices (use PROPOSE_SEND_INVOICE if needed later).

Call get_skill("create-invoice-draft") before emitting this action.
