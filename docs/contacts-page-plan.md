# Contacts Page Implementation Plan

## Overview
Create a full UI for managing contacts (customers/vendors) with international support, plus invoice creation from AI chat.

## Current State
- `Contact` model exists in `prisma/schema.prisma`: `id`, `name`, `email`, `type`, `createdAt`, `updatedAt`
- `Contact` linked via `JournalLine.contactId` (nullable)
- Seed includes sample contact "Acme Corp" (type: CUSTOMER)
- Current `/contacts` page is a placeholder

## Design Goals
- Pagination (server-side for performance)
- Search by name/email/type
- Add contact form with validation
- International/international-friendly fields
- Follow existing patterns (AccountsPanel, Admin UI)
- **Auto-create contacts from uploaded invoices (PDF/JPG)**
- **Invoice creation from AI chat with contact lookup**

## Implementation Steps

### 1. Extended Contact Model (`prisma/schema.prisma`)
Add fields for complete contact information:
```prisma
model Contact {
  id        String   @id @default(uuid())
  name      String
  email     String?
  type      String   // "CUSTOMER" or "VENDOR"
  phone     String?  // International format
  address   String?  // Multi-line billing address
  taxId     String?  // VAT/EIN/tax identification
  currency  String?  // Preferred currency (ISO 4217), fallback to company default
  notes     String?  // Internal notes
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2. API Routes (`app/api/contacts/`)
- `GET /api/contacts` - List contacts with search, pagination
  - Query params: `search`, `type`, `page`, `limit`
  - Returns: `{ contacts: [], total: number, page: number, pages: number }`
- `POST /api/contacts` - Create contact
  - Body: `{ name, email?, type, phone?, address?, taxId?, currency?, notes? }`
  - Validation with Zod
  - Audit logging via Event
- `PUT /api/contacts/[id]` - Update contact
- `DELETE /api/contacts/[id]` - Delete contact (only if no journal lines)
- `POST /api/contacts/lookup-or-create` - Find or create contact (for AI chat)

### 2.5 Duplicate Detection (Confidence-Based)
Similar to merchant matching in Phase 1, use fuzzy matching to prevent duplicates:
- `GET /api/contacts/lookup-or-create` - Search with confidence scores:
  - Query params: `name`, `type`, `minConfidence` (default 0.8)
  - Compare against existing contacts using:
    - Exact name match → 1.0 confidence
    - Normalized name match (case, punctuation) → 0.9
    - Partial name match (contains) → 0.7
    - Levenshtein distance < 3 → 0.6
    - Email domain match → 0.5
  - Return all matches above threshold with scores
  - If no matches, create new contact

### 3. Contact Form Fields
```typescript
interface ContactForm {
  name: string          // Required, min 2 chars, max 100, UTF-8
  email?: string        // Optional, valid email format, max 200
  type: 'CUSTOMER' | 'VENDOR'  // Required
  phone?: string        // Optional, max 50 (international, + spaces)
  address?: string      // Optional, multi-line
  taxId?: string        // Optional, VAT/EIN (various formats)
  currency?: string     // ISO 4217 code, default from company settings
  notes?: string        // Optional, internal notes
}
```

### 4. Contacts Page UI (`app/contacts/page.tsx`)
- Search input with debounced filtering
- Contact type filter (All/CUSTOMER/VENDOR)
- Pagination controls (prev/next, page numbers)
- Add contact button + form modal
- Contact list with:
  - Name (clickable to view/edit)
  - Email (mailto link)
  - Type badge (color-coded)
  - Entry count (linked to filtered journal)
  - Actions (edit, delete)
- Responsive design (mobile-friendly)

### 5. Internationalization Considerations
- Phone numbers: Allow + and spaces, no strict formatting
- Tax IDs: No format validation (EU VAT, US EIN, etc. vary)
- Currencies: Support all ISO 4217 codes
- Names: Full UTF-8 support for international characters
- Addresses: Multi-line text area, no specific format

### 6. AI Chat Integration for Invoices

#### 6.1 Auto-Contact Creation from PDF (existing `/api/invoices/process`)
The PDF processing route (`app/api/invoices/process/route.ts`) already extracts:
- **Vendor name** via `guessVendor()` - returned in `detected.vendor`
- **Total amount** via `guessTotal()` - returned in `detected.total`
- **Currency** via `detectCurrency()` - returned in `detected.currency`

**Integration point** (in `app/api/invoices/process/route.ts`):
After successful vendor extraction (line 350), add:
```typescript
// Auto-create contact from detected vendor
let contactId: string | undefined
if (vendor) {
  try {
    const contactRes = await fetch(`${process.env.NEXT_PUBLIC_URL || ''}/api/contacts/lookup-or-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: vendor, type: 'VENDOR' })
    })
    if (contactRes.ok) {
      const contactData = await contactRes.json()
      contactId = contactData.contact?.id
    }
  } catch {}
}
```

Then include `contactId` in the suggestion response for linking in journal entry creation.

**Frontend integration** (in `app/app/page.tsx`):
After PDF processing, the suggestion already contains `merchant`. Add contact lookup in the chat flow and link `contactId` to appropriate journal lines.

#### 6.2 Invoice Creation Intent via Chat
Add detection for "invoice for X" patterns in `app/api/chat/route.ts`:
- Detect when user wants to create an invoice (vs recording expense)
- Extract client/customer name
- Use contact lookup-or-create to ensure client exists
- Return structured suggestion with contact reference

#### 6.3 Journal Entry Integration
When creating journal entries from chat/PDF:
- For **CUSTOMER** payments: Link to contact on revenue lines
- For **VENDOR** invoices: Link to contact on expense lines
- The `contactId` flows through `SuggestionSchema.lines[].contactId`

### 7. Integration Points
- Contact picker in journal entry modal (future)
- Revenue/expense reports grouped by contact
- Bank feed matching (customer payments → match to CUSTOMER, vendor bills → match to VENDOR)
- Invoice number sequence (via settings or dedicated table)

## Files to Create/Modify
- `prisma/schema.prisma` - Extend Contact model
- `app/api/contacts/route.ts` - List + create
- `app/api/contacts/[id]/route.ts` - Update + delete
- `app/api/contacts/lookup-or-create/route.ts` - Find or create helper
- `app/contacts/page.tsx` - Main page UI
- `app/contacts/layout.tsx` - Layout with TopBar (exists)
- `messages/en.json` - Add `contacts` translations

## Translations Required
```json
"contacts": {
  "title": "Contacts",
  "add": "+ Add Contact",
  "name": "Name",
  "email": "Email",
  "type": "Type",
  "customer": "Customer",
  "vendor": "Vendor",
  "phone": "Phone",
  "address": "Address",
  "taxId": "Tax ID",
  "currency": "Currency",
  "notes": "Notes",
  "searchPlaceholder": "Search contacts...",
  "noContacts": "No contacts yet.",
  "adding": "Adding...",
  "save": "Save",
  "cancel": "Cancel",
  "edit": "Edit Contact",
  "delete": "Delete",
  "deleteConfirm": "Delete this contact? (only possible if no entries)",
  "deleteBlocked": "Cannot delete: contact has journal entries",
  "viewEntries": "View entries",
  "contactCreated": "Contact created from invoice",
  "invoiceCreated": "Invoice draft created"
}
```

## Status
- **Phase:** MVP (basic listing + CRUD) + invoice integration
- **Priority:** High (Phase 3 core feature)
- **Estimated effort:** 3-4 hours

## Future (Phase 4+)
- Full Invoice model with PDF generation
- Payment matching to bank feeds
- Contact merge/suggestions
- Bulk import from CSV/VCF