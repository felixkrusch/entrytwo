# Remote Update Function

This document outlines the implementation of a one-click update system for entrytwo, allowing remote updates via an admin interface that automatically handles code updates and database migrations.

---

## Overview

The update system provides:
- **One-click update button** in the admin UI
- **Automatic backup** before updating (using existing backup endpoint)
- **Git pull** to fetch latest code
- **Prisma migration** if schema changes detected
- **Build & restart** without downtime
- **Rollback capability** on failure

---

## Implementation Status: ✅ IMPLEMENTED

### Files Created

- `app/api/admin/update/route.ts` - GET/POST endpoints for checking and executing updates
- `app/admin/update/page.tsx` - Admin UI page at `/admin/update`
- `app/admin/page.tsx` - Updated with update indicator dot

---

## Current Implementation (Git-based)

### Update Endpoint (`app/api/admin/update/route.ts`)

**GET** - Check for available updates:
- Compares local commit (`git rev-parse HEAD`) with remote (`git rev-parse origin/main`)
- Returns update status with current/latest commit hashes
- Runs every minute in background when admin page is open

**POST** - Execute update process:
1. Verifies no update is already in progress (lock file)
2. Creates backup via `/api/backup/export` (stored in `backups/pre-update-{timestamp}.json`)
3. Runs `git pull origin main`
4. Runs `npm install --omit=dev` (production dependencies only)
5. Runs `npx prisma migrate deploy` (production-safe migration)
6. Runs `npm run build`
7. Creates `.restart` signal file for external process manager
8. Logs audit event to `Event` table

### Admin UI (`/admin/update`)

```
┌─────────────────────────────────────┐
│ System Update                        │
├─────────────────────────────────────┤
│ Current Version: #abc123             │
│ Available Update:  #def456           │ ← Shows only when update available
│                                       │
│ [x] Create backup before update      │
│                                       │
│ [ Check for Updates ]  [ Update Now ] │
│                                       │
└─────────────────────────────────────┘
```

### Progress View (During Update)

```
┌─────────────────────────────────────┐
│ Updating...                          │
├─────────────────────────────────────┤
│ [■■■■■■■■■■]                       │
│                                       │
│ Pulling latest code... ✓              │
│ Installing dependencies... ✓           │
│ Running database migrations... ✓       │
│ Building application... ✓              │
│ Restarting server... ✓                 │
└─────────────────────────────────────┘
```

### Dashboard Indicator

When an update is available, a green pulsing dot appears next to the "System Update" link in the admin overview.

---

## Deployment Requirements

### Server-Side Git (Current Implementation)

**Requirements:**
- Node.js server with git installed
- Write access to codebase directory
- Process manager (PM2, systemd, or Docker) to handle restarts
- `NEXT_PUBLIC_APP_URL` set for internal API calls during update

### External Process Manager Integration

Create a restart script that monitors for `.restart` file:

```bash
#!/bin/bash
# restart-watcher.sh
while true; do
  if [ -f .restart ]; then
    rm .restart
    echo "Restart signal detected, restarting..."
    pm2 restart entrytwo
  fi
  sleep 5
done
```

Or use PM2 ecosystem config:
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'entrytwo',
    script: 'npm start',
    watch: ['./.restart'],
    // ... config
  }]
}
```

---

## Database Migration Handling

### Automatic Detection

The update endpoint runs `prisma migrate deploy` which:
- Compares migration history with current DB state
- Only applies migrations that haven't run yet
- Is production-safe (won't prompt for interactive decisions)

### Migration Process

If migration fails:
1. Error is returned to client
2. Backup file remains available for manual restore
3. Git workspace may need manual reset

---

## Security Considerations

- Only accessible when authenticated (middleware)
- Update lock prevents concurrent updates
- All update actions logged via `Event` table with `eventType: 'SYSTEM'`
- Backup created automatically before any destructive operations

---

## Rollback Procedure

If update fails:

1. **Manual rollback**:
   ```bash
   git reset --hard HEAD~1
   npm install
   npm run build
   # Restart server
   ```

2. **Data restore**:
   - Go to `/admin/backup`
   - Upload the backup created before update (`backups/pre-update-*.json`)

---

## Future Enhancements

- **Docker image pull** mode (instead of git)
- **Auto-update toggle** for patch versions
- **Health checks** after update
- **Notifications** via email/slack on completion
- **Scheduled updates** during maintenance windows
- **Release notes** display from GitHub API

---

## Related Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/backup/export` | Pre-update backup |
| `POST /api/backup/import` | Rollback from backup |
| `GET /api/admin/update` | Check for updates |
| `POST /api/admin/update` | Execute update |

---

## Environment Variables (Optional)

```env
# For internal API calls during update
NEXT_PUBLIC_APP_URL="https://yourdomain.com"
```