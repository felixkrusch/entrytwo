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
- ✅ Contacts management with fuzzy matching
- ✅ Health check endpoint for monitoring

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
- Create `lib/rate-limit.ts` using a token bucket algorithm
- Apply to all `/api/*` routes
- Configure limits: 60 req/min for authenticated, 10 req/min for unauthenticated

### 3. Health Check Endpoint ✅ DONE
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

### 6. Contacts Feature ✅ DONE
- `/api/contacts` routes with fuzzy match duplicate detection
- Contacts page UI with search + pagination
- Auto-contact creation from PDF uploads
- Contact linking to journal entries
- **ISO-standard address fields**: street, city, state/province (ISO 3166-2), ZIP, country (ISO 3166-1 alpha-2)
- **VAT validation**: EU VAT ID verification via VIES API

#### VAT Validation Implementation
The `validate-vat` API endpoint uses the EU's VAT Information Exchange System (VIES) REST API to validate European VAT numbers.

**Production note**: VIES has rate limiting and is not designed for high-volume automated use. For production, implement a caching proxy or use a commercial VAT validation service.

### 7. Backup System Improvements ✅ DONE
- Selective export/import to `/admin/backup` with entity checkboxes
- Supports accounts, taxRates, journalEntries, contacts, templates, settings

### 8. Docker Compose for Updates
Add `compose.update.yaml` for containerized deployments.  
**Features:**
- Multi-service orchestration (app, db, redis)
- Automatic backup volume mounting
- Restart signal handling via `.restart` file

### 9. Restart Watcher Script ✅ DONE
Production-ready script for PM2/systemd to handle `.restart` signal.  
**Location:** `scripts/restart-watcher.sh`  
**Integration:**
- PM2 ecosystem config with watch on `.restart`
- Or systemd path unit to trigger service restart

---

## VAT Validation Considerations

**VIES API Limitations:**
- Rate limiting: VIES throttles excessive requests (not intended for bulk validation)
- EU-only: Only validates VAT IDs for EU member states
- Reliability: Occasional network timeouts and service outages

**Recommended Production Approach:**
- Cache validation results (24-48 hour TTL)
- Queue validations to respect rate limits
- Consider commercial services (VATsense, Sovos, Taxamo) for high-volume needs
- Fallback to manual validation when VIES unavailable

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