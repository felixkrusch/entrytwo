# Backup System Improvement Plan

## Overview
Enhance the backup/export feature with selective export/import and better UX.

## Current State
- `POST /api/backup/export` - Exports all data (accounts, tax rates, journal entries, settings, templates)
- `POST /api/backup/import` - Imports all data (adds to existing)
- Admin page exists at `/admin/backup` with simple buttons

## Improvements Needed

### 1. Selective Export/Import Modal
Replace simple buttons with a modal allowing users to choose what to export/import.

#### Modal UI Features
- Checkboxes for each entity type:
  - [ ] Accounts
  - [ ] Tax Rates
  - [ ] Journal Entries
  - [ ] Contacts (future)
  - [ ] Templates
  - [ ] Settings
  - [ ] Users
- Date range filter for journal entries (optional)
- Export preview showing counts for each selection
- Import mode selection:
  - Merge (default) - Add to existing data
  - Replace - Clear existing before import
  - Skip duplicates - Ignore conflicting records

### 2. Export API Enhancement (`app/api/backup/export/route.ts`)
Add query parameters:
```
GET /api/backup/export?type=accounts,taxes,entries&from=2024-01-01&to=2024-12-31
```

Support types:
- `accounts` - Chart of accounts
- `taxes` - Tax rates
- `entries` - Journal entries
- `templates` - Transaction templates
- `settings` - Company settings
- `users` - User accounts
- `contacts` - Contact records (future)

Response format:
```json
{
  "metadata": {
    "exportedAt": "ISO timestamp",
    "version": "1.0",
    "counts": { "accounts": 12, "entries": 45 }
  },
  "data": {
    "accounts": [...],
    "entries": [...]
  }
}
```

### 3. Import API Enhancement (`app/api/backup/import/route.ts`)
Accept `mode` parameter:
- `merge` - Add to existing (current behavior)
- `replace` - Delete existing records of same type first
- `skip` - Ignore records that conflict (by unique key)

Add `dryRun` option to preview without writing.

### 4. Backup Before Update
- When update runs, automatically export data as backup
- Save to `.backups/update-YYYYMMDD-HHMM.json`
- Include in `.update-lock` metadata
- Rollback option if update fails

### 5. UI Wireframe
```
Export Data
[ ] Accounts (12)
[ ] Tax Rates (5)
[ ] Journal Entries (45)
[ ] Templates (3)
[ ] Settings (8)
[ ] Users (3)

Date range: [from] - [to] (optional)
[Export Selected] [Export All]

Import Data
Drag & drop JSON file here
Mode: [Merge] [Replace] [Skip duplicates]
[Import Preview]
```

## Files to Create/Modify
- `app/api/backup/export/route.ts` - Add type filters
- `app/api/backup/import/route.ts` - Add mode options
- `app/admin/backup/page.tsx` - Replace with modal UI
- `lib/backup-utils.ts` - Shared export/import logic

## Status
- **Priority:** Medium
- **Estimated effort:** 2-3 hours