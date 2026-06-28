# Production-Ready Checklist

**Last Updated:** 2026-06-28

---

## Core System Status

The entrytwo accounting application is functionally complete for Phase 3 with the following subsystems implemented:

### Completed Features
- ✅ Authentication (Magic Link via NextAuth.js, TOTP 2FA)
- ✅ Bank feeds (Stripe/PayPal webhooks, Plaid/Salt Edge skeleton)
- ✅ Admin UI (users, company, tax, reports, update system)
- ✅ Journal entries with multi-currency support
- ✅ Reports (balance sheet, profit & loss, tax summary)
- ✅ Audit logging with detail view modal
- ✅ Transaction templates panel
- ✅ Data export/import for backup/migration
- ✅ Remote update system with file-based lock

---

## Remaining Items for Full Production Polish

### 1. Error Boundaries in React Components
Add error boundary components to gracefully handle UI errors and prevent crashes.  
**Files to modify:**
- `app/app/*` - Wrap panels in error boundaries
- `app/admin/*` - Add error fallbacks

### 2. Rate Limiting Middleware
Protect API routes from abuse and DoS attacks.  
**Implementation:**
- Create `middleware/rate-limit.ts` using a token bucket algorithm
- Apply to all `/api/*` routes
- Configure limits: 60 req/min for authenticated, 10 req/min for unauthenticated

### 3. Health Check Endpoint
Create `/api/health` for monitoring and uptime checks.  
**Requirements:**
- Return 200 OK with DB connectivity check
- Include uptime, version, and migration status
- Use for Kubernetes/Docker health probes

### 4. Environment Validation
Add startup validation for required environment variables.  
**Required variables:**
- `ENCRYPTION_KEY` (64 hex chars for AES-256-GCM)
- `STRIPE_WEBHOOK_SECRET` (for webhook signature verification)
- `DATABASE_URL` (PostgreSQL connection)
- `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS` (for magic links)

**Implementation:**
- Create `lib/env-validate.ts` with startup checks
- Fail fast if critical variables missing in production mode

### 5. Test Coverage
Add comprehensive test suites.  
**Priority areas:**
- `lib/matching.ts` - Merchant matching logic
- `lib/taxDirection.ts` - Tax input/output determination
- API routes - Request validation and response format
- Report calculations - P&L and balance sheet totals

### 6. Docker Compose for Updates
Add `compose.update.yaml` for containerized deployments.  
**Features:**
- Multi-service orchestration (app, db, redis)
- Automatic backup volume mounting
- Restart signal handling via `.restart` file

### 7. Restart Watcher Script
Production-ready script for PM2/systemd to handle `.restart` signal.  
**Location:** `scripts/restart-watcher.sh` (already created)  
**Integration:**
- PM2 ecosystem config with watch on `.restart`
- Or systemd path unit to trigger service restart

### 8. Input Validation Schemas
Add Zod schemas for all API request bodies.  
**Routes to validate:**
- `/api/journal-entries` - Entry creation payload
- `/api/settings` - Key/value pairs
- `/api/tax-rates` - Tax rate objects
- `/api/templates` - Template definitions

---

## Contact & Invoicing (Out of Scope for MVP)

Per `Project-Scope-Architecture.md`, invoicing is explicitly **out of scope** for Phase 0-3 MVP. The following data model exists but without full UI:

### Contact Model (Prisma)
```
model Contact {
  id        String   @id @default(uuid())
  name      String
  email     String?
  type      String   // "CUSTOMER" or "VENDOR"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Contact Links
- `JournalLine.contactId` references Contact (nullable)
- Seed data includes sample contact "Acme Corp" (type: CUSTOMER)

### Invoicing Ideas (Future Implementation)
When invoicing is added (Phase 4+):
1. **Invoice model** with:
   - Invoice number (sequential)
   - Contact reference
   - Line items with amounts
   - Tax breakdown per line
   - Status (draft, sent, paid, overdue)

2. **UI considerations**:
   - Contact picker with address/details
   - Line item table with tax rate selector
   - PDF generation endpoint
   - Payment matching to bank feeds

3. **Integration with existing features**:
   - Auto-create journal entry on invoice payment
   - Tax calculation matches existing tax engine
   - Multi-currency support per existing architecture

---

## Deployment Checklist

- [ ] Set up process manager (PM2 or systemd)
- [ ] Configure HTTPS termination
- [ ] Set up automated backups (daily + pre-update)
- [ ] Configure log rotation
- [ ] Add monitoring (health endpoint + optional metrics)
- [ ] Test update flow in staging environment
- [ ] Document rollback procedure for users

---

## Security Considerations

- All API routes require authentication (middleware enforces)
- Admin routes require ADMIN role (verify in implementation)
- Stripe/PayPal webhooks verify signatures in production
- Bank credentials encrypted at rest (AES-256-GCM)
- TOTP secret encrypted for 2FA
- No secrets in database (except encrypted credentials)