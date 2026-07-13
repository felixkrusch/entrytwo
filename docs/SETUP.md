# entrytwo - Setup & Deployment Guide

This guide walks you through getting a local development instance of entrytwo running from scratch, including the database, seeding, and creating your first admin user.

---

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 14+ (local or via Docker)
- Git

Optional but recommended:
- Docker & Docker Compose (for the included compose files)

---

## 2. Quick Start (Recommended)

```bash
# 1. Clone
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set your DATABASE_URL

# 4. Start PostgreSQL (choose one)

# Option A: Docker Compose (easiest)
docker compose up -d

# Option B: Local Postgres
# Make sure you have a database called "entrytwo" and update DATABASE_URL accordingly.

# 5. Run migrations and seed
npx prisma migrate dev
npm run db:seed   # or: npx prisma db seed

# 6. Start the app
npm run dev
```

Open http://localhost:3000

On first visit you should be able to create the initial **ADMIN** user if none exists (see "First Admin Bootstrap" below).

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/entrytwo"
DATABASE_URL_TEST="postgresql://user:password@localhost:5432/entrytwo_test"

# Auth.js
AUTH_SECRET="change-this-in-production"

# Email for Magic Link (choose one)
# SMTP (works with any SMTP server)
SMTP_HOST=""       # smtp.gmail.com, etc.
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@yourdomain.com"

# Or Resend API (recommended for cloud)
RESEND_API_KEY=""

# OAuth providers (optional)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# Bank feed encryption (required for storing provider credentials)
ENCRYPTION_KEY=""  # 64 hex characters (32 bytes)

# Stripe webhook verification (required for production)
STRIPE_WEBHOOK_SECRET=""

# LLM keys (optional for Phase 1+)
OPENAI_API_KEY=""
XAI_API_KEY=""
ANTHROPIC_API_KEY=""
```

---

## 4. Obtaining OAuth Credentials

### Google OAuth

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client IDs**
5. Choose **Web application** type
6. Set **Authorized redirect URI**: `https://yourdomain.com/api/auth/callback/google`
7. Copy the Client ID and Client Secret to your `.env` file

### GitHub OAuth

1. Visit [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: entrytwo
   - **Homepage URL**: `https://yourdomain.com`
   - **Authorization callback URL**: `https://yourdomain.com/api/auth/callback/github`
4. Register the application
5. Copy the Client ID and Client Secret to your `.env` file

### Stripe (Payment Processor Feed)

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Go to **Developers** → **Webhooks**
3. Click **Add endpoint**
4. Set endpoint URL: `https://yourdomain.com/api/webhooks/stripe`
5. Select events: `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`
6. Copy the **Webhook secret** to `STRIPE_WEBHOOK_SECRET` in `.env`
7. Set your **Secret key** (`sk_live_...` or `sk_test_...`) as `STRIPE_SECRET_KEY` in `.env`

### PayPal (Payment Processor Feed)

1. Create a REST application in the PayPal Developer Dashboard.
2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` in `.env`.
3. Create a webhook pointing to `https://yourdomain.com/api/webhooks/paypal`.
4. Set the resulting webhook ID as `PAYPAL_WEBHOOK_ID`.

Stripe and PayPal are the only supported live processor feeds. Other bank and card data is imported by uploading statements or transaction tables through chat.

---

## 5. Database

### Using Docker Compose (included)

```bash
docker compose up -d
```

This starts a Postgres container on port 5432 with the credentials from `compose.yaml`.

### Manual Postgres

Create a database:

```sql
CREATE DATABASE entrytwo;
CREATE USER entrytwo WITH PASSWORD 'entrytwo_dev_password';
GRANT ALL PRIVILEGES ON DATABASE entrytwo TO entrytwo;
```

Then set:

```env
DATABASE_URL="postgresql://entrytwo:entrytwo_dev_password@localhost:5432/entrytwo"
```

### Migrations

```bash
npx prisma migrate dev
```

### Seeding

The seed creates:
- Standard chart of accounts
- Common tax rates (DE 19%/7%, AT 20%, US-CA 8.25%)
- A few sample contacts

```bash
npm run db:seed
# or
npx prisma db seed
```

---

## 6. First Admin Bootstrap (Important)

entrytwo is designed so that the very first user created in a fresh installation becomes an **ADMIN**.

Current behavior (development):
- If no `User` with role `ADMIN` exists, the system allows creating the first admin via a simple form (this will be surfaced in the Admin UI).
- Subsequent users can be created with roles `ADMIN`, `ACCOUNTANT`, or `VIEWER`.

In production this flow will be protected and usually triggered during initial onboarding.

---

## 7. Running the Application

```bash
npm run dev
```

- Chat interface is on the left.
- Dynamic panels (accounts, journal, reports, P&L, audit) on the right.
- Upload PDF button is in the top bar.

---

## 8. Docker (Full Stack)

```bash
docker compose up --build
```

This will start the Next.js app + Postgres. Adjust ports in `compose.yaml` / `compose.debug.yaml` as needed.

---

## 9. Common Commands

```bash
# Database
npx prisma studio                 # Browse data
npx prisma migrate reset          # Danger: resets DB
npm run db:seed                   # Re-seed

# Code quality
npm run build
npm run lint
npm test                          # Requires a separate database ending in _test

# Production
npm run build
npm start
```

---

## 10. First Time Checklist

- [ ] Database is running and `DATABASE_URL` is correct
- [ ] `npx prisma migrate dev` succeeded
- [ ] Seed completed (`npm run db:seed`)
- [ ] First ADMIN user created
- [ ] You can see the chart of accounts and create a manual journal entry
- [ ] You can upload a PDF and get a suggestion with currency + tax (if detected)
- [ ] Bank feed connections work (add `{"apiKey":"sk_test_..."}` for Stripe)
- [ ] OAuth login tested (optional: set GOOGLE_CLIENT_ID/SECRET)

---

## 11. Production Considerations

- Use a strong `AUTH_SECRET` (required for Auth.js)
- Enable HTTPS
- Set up proper email delivery for magic links (or use OAuth)
- Use a managed Postgres (or well-secured self-hosted)
- Regular backups
- Set `ENCRYPTION_KEY` for bank feed credential storage
- Set `STRIPE_WEBHOOK_SECRET` for webhook signature verification
- Consider read replicas for reporting

**Authentication Status:**
- ✅ Phase 3: Auth.js Magic Link via Email (SMTP or dev fallback)
- ✅ Phase 3: RFC 6238 TOTP 2FA, mandatory administrator setup, and one-time recovery codes
- ✅ Phase 3: OAuth login (Google, GitHub - requires env vars)

---

## 12. Troubleshooting

**"Error: P1001: Can't reach database server"**
- Check that Postgres is running and the host/port in `DATABASE_URL` are correct.
- For Docker, make sure you're connecting to the service name (`db`) from inside the container or use `localhost` from the host.

**Seed fails with unique constraint**
- Run `npx prisma migrate reset` (this will wipe data).

**Prisma client out of date after schema change**
```bash
npx prisma generate
```

---

## 13. Data Export/Import (Backup & Migration)

**Implemented:** Portable full-system backup and restore via Admin → Backup:
- A compressed `.etbackup` archive contains every database table and uploaded receipt/statement.
- SHA-256 checksums and row counts are validated before restore.
- Restore is a complete replacement intended for disaster recovery or migration to a fresh installation.
- The destination must use the original `ENCRYPTION_KEY` so encrypted bank credentials remain usable.

For complete database backup, use standard PostgreSQL tools:
```bash
# Export
pg_dump entrytwo > backup.sql

# Import  
psql entrytwo < backup.sql
```
