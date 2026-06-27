# Remote Update Function

This document outlines the implementation of a one-click update system for entrytwo, allowing remote updates via an admin interface that automatically handles code updates and database migrations.

---

## Overview

The update system provides:
- **One-click update button** in the admin UI
- **Automatic backup** before updating (using direct DB export)
- **Git pull** to fetch latest code
- **Prisma migration** if schema changes detected
- **Build & restart** signal for process manager
- **Rollback capability** on failure

---

## Implementation Status: ✅ IMPLEMENTED

### Files Created

- `app/api/admin/update/route.ts` - GET/POST endpoints for checking and executing updates
- `app/admin/update/page.tsx` - Admin UI page at `/admin/update`
- `app/admin/page.tsx` - Updated with update indicator dot
- `scripts/restart-watcher.sh` - Background script for PM2/systemd restart handling

---

## Current Implementation (Git-based)

### Update Endpoint (`app/api/admin/update/route.ts`)

**GET** - Check for available updates:
- Compares local commit (`git rev-parse HEAD`) with remote (`git rev-parse origin/main`)
- Uses `.update-lock` file to detect in-progress updates
- Returns: `{ currentCommit, latestCommit, updateAvailable, status, progress }`
- Background polling every 60 seconds when admin page is open

**POST** - Execute update process:
1. Checks for existing lock (prevents concurrent updates)
2. Creates backup directly from DB (more reliable than HTTP during update)
3. Runs `git pull origin main`
4. Runs `npm install --omit=dev` (production dependencies)
5. Runs `npx prisma migrate deploy` (production-safe)
6. Runs `npm run build`
7. Creates `.restart` signal file
8. Logs audit event to `Event` table

### Admin UI (`/admin/update`)

```
┌─────────────────────────────────────┐
│ System Update                        │
├─────────────────────────────────────┤
│ Current Version: #abc123             │
│ Available Update:  #def456           │ ← Shows when update available
│                                       │
│ [x] Create backup before update      │
│                                       │
│ [ Check for Updates ]  [ Update Now ] │
│                                       │
└─────────────────────────────────────┘
```

### Dashboard Indicator

When an update is available, a green pulsing dot appears next to the "System Update" link in `/admin`.

---

## Deployment Requirements

### Server-Side Git (Current Implementation)

**Requirements:**
- Node.js server with git installed and write access
- `.git` directory must exist and track `origin/main`
- Process manager (PM2, systemd, or Docker) to handle restarts
- User running the server must have write permissions

### Process Manager Integration

**Option A: PM2 Ecosystem Config**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'entrytwo',
    script: 'npm start',
    cwd: '/app/entrytwo',
    env: { NODE_ENV: 'production' },
  }, {
    name: 'restart-watcher',
    script: './scripts/restart-watcher.sh',
    cwd: '/app/entrytwo',
  }]
}
```

**Option B: Systemd Service**
```ini
# /etc/systemd/system/entrytwo.service
[Unit]
Description=entrytwo
After=network.target

[Service]
Type=simple
User=entrytwo
WorkingDirectory=/app/entrytwo
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

Then run the restart-watcher as a separate service or cron job.

---

## Production Ready Checklist

### ✅ Already Implemented
- [x] Admin-only access (via middleware)
- [x] Lock file prevents concurrent updates
- [x] Automatic pre-update backup to `backups/pre-update-{timestamp}.json`
- [x] Direct DB export (doesn't rely on HTTP during update)
- [x] Production-safe Prisma migrations (`prisma migrate deploy`)
- [x] Build step before restart signal
- [x] Audit logging to Event table
- [x] Progress tracking via lock file JSON content

### 🔧 Requires Setup
- [ ] Process manager configured to watch `.restart` file
- [ ] Server user has git write access
- [ ] Backups directory exists with write permissions
- [ ] `git remote set-url origin <repo-url>` configured for production

---

## Rollback Procedure

If update fails:

1. **Stop the server** to release lock file
2. **Manual rollback**:
   ```bash
   git reset --hard HEAD~1
   npm install --omit=dev
   npm run build
   # Restart server
   ```

3. **Data restore** (if needed):
   - Go to `/admin/backup`
   - Upload the backup from `backups/pre-update-*.json`

---

## Security Considerations

- **Authentication**: Only accessible when authenticated (protected by middleware)
- **Authorization**: In production, verify `role === 'ADMIN'` in session
- **Lock file**: Persists across server restarts, prevents race conditions
- **Audit trail**: All update attempts logged via `Event` table

---

## Future Enhancements

- Docker image pull mode (instead of git)
- Auto-update toggle for patch versions
- Health checks after update
- Notifications via email/slack
- Scheduled updates during maintenance windows
- Release notes from GitHub API

---

## Related Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/update` | Check for updates |
| `POST /api/admin/update` | Execute update |
| `GET /api/backup/export` | Manual backup |
| `POST /api/backup/import` | Restore from backup |

---

## Environment Variables

No additional environment variables required. The update system uses:
- Server's git configuration
- Server's file system for lock/backup files
- Existing `prisma` connection for backups