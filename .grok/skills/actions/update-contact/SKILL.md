# UPDATE_CONTACT skill

Use when the user wants to modify an existing contact.

## Exact shape

```json
{
  "action": "UPDATE_CONTACT",
  "params": {
    "contactId": "c_abc123",
    "name": "Kaiser & Kaiser GmbH",
    "type": "CUSTOMER",
    "email": "billing@kaiser.de",
    "addressStreet": "..."
  },
  "confidence": 0.9,
  "reasoning": "User wants to update the contact details."
}
```

## Resolution

- Provide either `contactId` (preferred) or a unique `contactName` that the server can resolve to an existing contact.
- Only include fields that should change.

Call `get_skill("update-contact")` before emitting.
