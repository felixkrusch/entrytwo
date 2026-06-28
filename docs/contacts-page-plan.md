# Contacts Page Implementation Plan

## Status: ✅ COMPLETED (MVP)

### Implemented Features (June 2026)
- ✅ Extended Contact model with ISO-standard address fields: addressStreet, addressCity, addressState, addressZip, addressCountry (ISO 3166-1), addressLine2, phone (intl format)
- ✅ Added website and vatValid fields for VAT validation tracking
- ✅ `GET /api/contacts` - List with search, type filter, pagination
- ✅ `POST /api/contacts` - Create contact with validation
- ✅ `PUT /api/contacts/[id]` - Edit contact
- ✅ `DELETE /api/contacts/[id]` - Delete contact (blocked if journal entries exist)
- ✅ `GET/POST /api/contacts/lookup-or-create` - Fuzzy match duplicate detection (levenshtein scoring)
- ✅ `GET/POST /api/contacts/validate-vat` - EU VIES VAT validation with auto-fill
- ✅ Contacts page UI with search, type filter, pagination, add modal
- ✅ Click-to-edit contacts in list view
- ✅ Delete button in edit modal
- ✅ Auto-contact creation from PDF vendor extraction
- ✅ Contact linking in journal entries (contact selector in modal)

### Files Created/Modified
- `prisma/schema.prisma` - Extended Contact model with ISO address fields
- `app/api/contacts/route.ts` - List + create
- `app/api/contacts/[id]/route.ts` - Edit + delete endpoints
- `app/api/contacts/lookup-or-create/route.ts` - Find or create with fuzzy matching
- `app/api/contacts/validate-vat/route.ts` - VAT validation with auto-fill
- `app/app/layout.tsx` - ContactsContent component with ISO forms
- `app/contacts/page.tsx` - Redirects to /app?view=contacts
- `app/app/NewJournalEntryModal.tsx` - Contact selector
- `app/app/NewEntryContext.tsx` - Added contactId to SuggestedLine
- `app/api/invoices/process/route.ts` - Auto-contact creation from vendor
- `messages/en.json` - Added translations

### Remaining Features (Future)
- VAT validation caching (30 days)
- Smart matching from email/PDF signatures
- Payment prediction based on history
- Advanced deduplication with multi-field scoring
- Bulk merge UI for duplicates
- Full invoice model (Phase 4+)