# CREATE_CONTACT skill

Use this when the user gives details for a new contact (customer or vendor).

## Exact shape

```json
{
  "action": "CREATE_CONTACT",
  "params": {
    "name": "Kaiser & Kaiser",
    "type": "CUSTOMER",
    "email": "info@kaiser.de",
    "addressStreet": "Marktstrasse 1",
    "addressCity": "Dillenburg",
    "addressZip": "35745",
    "addressCountry": "DE",
    "taxId": "DE123456789",
    "currency": "EUR",
    "phone": "",
    "website": "",
    "notes": ""
  },
  "confidence": 0.9,
  "reasoning": "User provided name, address, country; normalized spelling and country code."
}
```

## Field rules

- `name`: required, full legal or trading name.
- `type`: "CUSTOMER" | "VENDOR". Default CUSTOMER if omitted.
- Address fields:
  - `addressStreet`, `addressCity`, `addressZip`, `addressCountry`
  - `addressCountry` must be ISO-2 code (DE, AT, CH, etc.). Correct common misspellings (Deutschland → DE).
  - If user gives unstructured address, intelligently split into the four fields.
- `email`, `phone`, `taxId`, `website`, `currency`, `notes` are optional.
- Do **not** emit UPDATE_CONTACT unless the user is explicitly editing an existing contact.

## Good example (unstructured input)

User: "Add Kaiser & Kaiser, marktstrasse 1, Dillenburg, 35745, Deutschland as customer"

Correct output (after studying this skill):

```json
{
  "action": "CREATE_CONTACT",
  "params": {
    "name": "Kaiser & Kaiser",
    "type": "CUSTOMER",
    "addressStreet": "Marktstrasse 1",
    "addressCity": "Dillenburg",
    "addressZip": "35745",
    "addressCountry": "DE"
  }
}
```

Output exactly one CREATE_CONTACT object. Do not emit free text + action in the same response.
