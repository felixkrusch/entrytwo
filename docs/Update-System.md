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

## Implementation Strategy

### 1. Update Endpoint (`/api/admin/update`)

```typescript
// POST /api/admin/update
export async function POST(request: Request) {
  // 1. Verify admin session
  // 2. Create backup
  // 3. Pull latest code (git pull origin main)
  // 4. Install dependencies (npm install)
  // 5. Run migrations (npx prisma migrate deploy)
  // 6. Build (npm run build)
  // 7. Restart server (or signal for hot reload)
}
```

### 2. Pre-Update Safety Checks

- Check if update is available (compare local commit with remote)
- Ensure sufficient disk space for backup
- Verify backup endpoint succeeded
- Confirm admin authentication

### 3. Backup Integration

Use existing `/api/backup/export` endpoint before update:
```typescript
const backupRes = await fetch('/api/backup/export', { method: 'GET' })
const backup = await backupRes.json()
// Store backup with timestamp: backup-2026-06-27.json
```

---

## Deployment Options

### Option A: Server-Side Git (Simplest)

**Requirements:**
- Server has git installed
- Server has write access to codebase
- Server runs Node.js with process manager (PM2, systemd, or Docker)

**Flow:**
1. Admin clicks "Check for Updates" in `/admin/update`
2. System runs `git fetch origin` to check for updates
3. If update available, shows "Update Available" with changelog
4. Admin confirms, system:
   - Calls `/api/backup/export` for pre-update backup
   - Runs `git pull origin main`
   - Runs `npm install --production`
   - Runs `npx prisma migrate deploy`
   - Runs `npm run build`
   - Restarts via process manager

### Option B: Docker Image Pull

**Requirements:**
- Application deployed via Docker
- Registry access (GitHub Container Registry, Docker Hub)

**Flow:**
1. New images pushed to registry on each release
2. Admin clicks "Check for Updates"
3. System checks for newer image tags
4. On confirm:
   - Creates backup via API
   - Runs `docker pull` for new image
   - `docker compose up -d --force-recreate`
   - Runs `prisma migrate deploy` in container

### Option C: Manual Download (Most Compatible)

**Requirements:**
- HTTP endpoint with release ZIP/TAR
- Server can download and extract

**Flow:**
1. Admin clicks "Check for Updates"
2. Pulls latest release info from GitHub API
3. Downloads release archive to temp location
4. Creates backup
5. Extracts to alternate directory
6. Runs migrations
7. Swaps symlink or copies files
8. Restarts

---

## Admin UI Design

### Update Page (`/admin/update`)

```
┌─────────────────────────────────────┐
│ Update & Maintenance                  │
├─────────────────────────────────────┤
│                                       │
│ Current Version: v0.3.1 (abc123)     │
│ Latest Version:  v0.3.2 (def456)    │
│ Status: Update available              │
│                                       │
│ Changes in v0.3.2:                    │
│ • Bank feed sync improvements         │
│ • OAuth credential setup guide        │
│ • Reports date filtering              │
│                                       │
│ [x] Create backup before update       │
│                                       │
│ [ Check for Updates ]  [ Update Now ]   │
│                                       │
└─────────────────────────────────────┘
```

### Progress View (During Update)

```
┌─────────────────────────────────────┐
│ Updating... 75%                       │
├─────────────────────────────────────┤
│ [■■■■■■■■□□□□□]                    │
│                                       │
│ 1. ✓ Backup created (backup-2026-)    │
│ 2. ✓ Code pulled                      │
│ 3. ✓ Dependencies installed           │
│ 4. ✓ Migrations applied               │
│ 5. ○ Building...                      │
│                                       │
└─────────────────────────────────────┘
```

---

## Database Migration Handling

### Automatic Detection

```bash
# Before pulling, check if schema.prisma changed
git diff --name-only HEAD origin/main | grep "prisma/schema.prisma"
```

### Migration Process

1. Compare current DB version with migration history
2. Run `npx prisma migrate deploy` (production-safe)
3. If migration fails, restore from backup and rollback

### Safety Features

- Migration runs in transaction when possible
- Backup created before migration attempt
- Clear error messages on failure
- Manual rollback instructions

---

## Security Considerations

### Access Control

- Only `ADMIN` role can access update endpoint
- Rate limit update checks (max 1 per hour)
- Log all update attempts via Event table

### Code Integrity

- Verify git signature or checksums if signed commits
- Use HTTPS for all external calls
- Sanitize any downloaded content

### Process Isolation

- Run update in separate process/subprocess
- Prevent concurrent updates
- Lock file to prevent conflicts

---

## Rollback Procedure

If update fails:

1. **Automatic rollback** (if implemented):
   ```bash
   git reset --hard HEAD~1
   npm install
   npm run build
   ```

2. **Manual rollback**:
   - Restore backup via `/api/backup/import`
   - Revert git to previous commit
   - Restart application

3. **Docker rollback**:
   ```bash
   docker compose down
   # Restore volume from backup
   docker compose up -d previous-tag
   ```

---

## Implementation Steps

### Step 1: Create Update API Route

Create `app/api/admin/update/route.ts`:
- GET: Check for available updates
- POST: Execute update process

### Step 2: Add Update UI Page

Create `app/admin/update/page.tsx`:
- Display current/lates version
- Show changelog from GitHub releases
- Trigger update via modal confirmation

### Step 3: Integrate with Backup System

- Call backup API before update
- Store backup with update timestamp
- Make backup available during rollback

### Step 4: Add Environment Config

```env
# Update configuration
UPDATE_METHOD="git"        # git | docker | download
GITHUB_REPO="org/repo"     # For release info
DOCKER_IMAGE="ghcr.io/org/repo"  # If using Docker
```

---

## Future Enhancements

- **Auto-update toggle**: Automatic updates for patch versions
- **Staged rollout**: Update subset of servers first
- **Health checks**: Verify update success before completing
- **Notifications**: Email/slack on update completion
- **Scheduled updates**: Update during maintenance window

---

## Related Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/backup/export` | Pre-update backup |
| `POST /api/backup/import` | Rollback from backup |
| `GET /api/admin/update` | Check for updates |
| `POST /api/admin/update` | Execute update |

---

## Current Status

**Not yet implemented.** This document serves as the specification for future development.

### Prerequisites for Implementation

- Server must have git installed and write access
- Process manager (PM2, systemd, or Docker)
- GitHub releases or package registry access
- Admin authentication fully working (currently in place)