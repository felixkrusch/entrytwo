# Contacts Page Implementation Plan

## Status: ✅ COMPLETED (MVP)

### Implemented Features (June 2026)
- ✅ Extended Contact model with phone, address, taxId, currency, notes, vatValidated fields
- ✅ `GET /api/contacts` - List with search, type filter, pagination
- ✅ `POST /api/contacts` - Create contact with validation
- ✅ `GET/POST /api/contacts/lookup-or-create` - Fuzzy match duplicate detection (levenshtein scoring)
- ✅ `GET /api/contacts/validate-vat` - EU VIES VAT validation endpoint
- ✅ Contacts page UI with search, type filter, pagination, add modal
- ✅ Auto-contact creation from PDF vendor extraction
- ✅ Contact linking in journal entries (contact selector in modal)

### Files Created/Modified
- `prisma/schema.prisma` - Extended Contact model
- `app/api/contacts/route.ts` - List + create
- `app/api/contacts/lookup-or-create/route.ts` - Find or create with fuzzy matching
- `app/api/contacts/validate-vat/route.ts` - VAT validation
- `app/contacts/page.tsx` - Main page UI
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