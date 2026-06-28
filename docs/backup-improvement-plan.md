# Backup System Improvement Plan

## Overview
Enhance the backup/export feature with selective export/import and better UX.

## Status: ✅ COMPLETED (MVP)

### Implemented Features
- ✅ Selective export via query params (`entities=accounts,taxRates,journalEntries,contacts,templates,settings`)
- ✅ Selective import with merge mode (update existing or create new)
- ✅ Admin UI with entity checkboxes for selective export
- ✅ Contact data included in backup

### Files Modified
- `app/api/backup/export/route.ts` - Added entity type query parameter
- `app/api/backup/import/route.ts` - Added contact import support
- `app/admin/backup/page.tsx` - Added entity selection checkboxes

### Remaining Enhancements (Future)
- Date range filter for journal entries
- Import mode selection (merge/replace/skip)
- Dry-run preview before import
- Automatic backup before system update