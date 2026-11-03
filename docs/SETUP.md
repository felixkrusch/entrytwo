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

# OAuth providers (optional) — Google and/or Microsoft Entra ID
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
MICROSOFT_ENTRA_ID_ID=""
MICROSOFT_ENTRA_ID_SECRET=""
MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/common/v2.0"
AUTH_URL="http://localhost:3000"

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
6. Set **Authorized redirect URI**: `https://yourdomain.com/api/auth/callback/google` (local: `http://localhost:3000/api/auth/callback/google`)
7. Copy the Client ID and Client Secret to your `.env` file

### Microsoft Entra ID OAuth

1. Open [Azure Portal → Microsoft Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps)
2. **New registration** → name it entrytwo
3. Supported account types: single tenant, or multitenant + personal Microsoft accounts (match your issuer)
4. Redirect URI (Web): `https://yourdomain.com/api/auth/callback/microsoft-entra-id` (local: `http://localhost:3000/api/auth/callback/microsoft-entra-id`)
5. Create a client secret under **Certificates & secrets**
6. Set in `.env`:
   - `MICROSOFT_ENTRA_ID_ID` = Application (client) ID
   - `MICROSOFT_ENTRA_ID_SECRET` = client secret value
   - `MICROSOFT_ENTRA_ID_ISSUER` = `https://login.microsoftonline.com/{tenant}/v2.0` or `.../common/v2.0`

### Magic links (SMTP)

Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and ideally `SMTP_FROM` + `AUTH_URL`.  
In local development you can leave SMTP empty and use instant email sign-in (`/api/auth/dev`).

**Production / VPS:** see [VPS-Auth-Install.md](./VPS-Auth-Install.md). Production refuses to start without at least one real auth method (SMTP and/or Google and/or Microsoft), a public `AUTH_URL`, strong `AUTH_SECRET`, and `AUTH_TRUST_HOST=true`.

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

### Option A: Build from source (default)

```bash
docker compose up --build
```

This builds the image locally from this checkout. Use this when you have cloned the repo.

### Option B: Pull from GHCR (no clone required)

If you don't have access to the private repo, run the published image directly:

```bash
# 1. Create an empty project dir
mkdir entrytwo && cd entrytwo

# 2. Create compose + env from the release artifacts, or write them by hand:
cat > compose.yaml <<'EOF'
services:
  app:
    image: ${APP_IMAGE:-ghcr.io/felixkrusch/entrytwo:latest}
    restart: unless-stopped
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@db:5432/entrytwo
      - APP_IMAGE=ghcr.io/felixkrusch/entrytwo:latest
      - COMPOSE_FILE=/app/entrytwo/compose.yaml
      - UPDATER_URL=http://updater:4000
      - UPDATER_TOKEN=${UPDATER_TOKEN:?required}
    ports:
      - "3000:3000"
    volumes:
      - ./backups:/app/entrytwo/backups
      - ./logs:/app/entrytwo/logs
      - ./uploads:/app/entrytwo/public/uploads
    depends_on:
      db:
        condition: service_healthy
      updater:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5

  updater:
    image: ghcr.io/felixkrusch/entrytwo:latest
    build:
      context: .
      dockerfile: ./updater/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      - UPDATER_PORT=4000
      - UPDATER_TOKEN=${UPDATER_TOKEN:?required}
      - UPDATE_VERIFY_SIGNATURE=true
      - APP_IMAGE=ghcr.io/felixkrusch/entrytwo:latest
      - COMPOSE_FILE=/app/entrytwo/compose.yaml
      - APP_PUBLIC_URL=http://app:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./compose.yaml:/app/entrytwo/compose.yaml:ro
      - ./backups:/app/entrytwo/backups

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=entrytwo
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  postgres_data:
EOF

# 3. Configure .env (copy from release notes / docs)
cp .env.example .env
# edit .env — set POSTGRES_PASSWORD, AUTH_SECRET, AUTH_URL, SMTP/OAuth, etc.

# 4. Start
docker compose up -d
```

This pulls `ghcr.io/felixkrusch/entrytwo:latest` (built and signed on every `v*` tag by the release workflow) — no `git clone` needed.

Adjust ports in `compose.yaml` / `compose.debug.yaml` as needed.

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
- [ ] OAuth and/or magic link tested when configured (optional in local dev — instant email is enough)
- [ ] Sign out works from the settings (gear) menu

---

## 11. Production Considerations

Full deploy guide: **[PRODUCTION.md](./PRODUCTION.md)**. Auth smoke table: **[VPS-Auth-Install.md](./VPS-Auth-Install.md)**.

- `NODE_ENV=production`; strong `AUTH_SECRET` (≥ 32 chars)
- `AUTH_URL` / `APP_PUBLIC_URL` = public **https** origin (no trailing slash)
- `AUTH_TRUST_HOST=true` behind nginx/caddy/traefik
- At least one real sign-in method: full SMTP and/or Google and/or Microsoft Entra ID — **required before first production boot**
- Instant email (`/api/auth/dev`) is **disabled** in production
- Point DNS at the VPS **before** expecting HTTPS (Caddy/Let’s Encrypt)
- New users after bootstrap need an invitation; OAuth/magic email must match the invite
- Admin TOTP is mandatory in production after first sign-in
- Use managed Postgres (or well-secured self-hosted); regular backups (Admin → Backup and/or `pg_dump`)
- Set `ENCRYPTION_KEY` for bank feed credential storage
- Set webhook secrets if using Stripe/PayPal feeds
- Confirm `GET /api/health` → `ready: true` and `auth.productionReady: true`
- Docker image must include `prisma.config.ts`; entrypoint runs migrations on start

**Authentication status (2026-07-25):**
- ✅ Magic link (Auth.js + `VerificationToken`, branded SMTP, single-use)
- ✅ TOTP 2FA (mandatory admin setup + recovery codes)
- ✅ OAuth (Google, Microsoft Entra ID), invitation-gated
- ✅ Sign out in settings menu
- ✅ Production env validation on boot via `instrumentation.ts`

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

**Docker: `datasource.url property is required` on migrate**
- Image must ship `prisma.config.ts`; `DATABASE_URL` must be set at runtime (entrypoint writes it for Prisma dotenv).

**Docker build: `AUTH_SECRET is required in production`**
- Current Dockerfile sets a build-only placeholder. Rebuild from latest `Dockerfile`.

**Production: configure at least one sign-in method**
- Set full SMTP (`SMTP_HOST` + `USER` + `PASS`) and/or OAuth before starting.

**HTTPS / SSL internal error in browser**
- Confirm `dig +short your.domain` returns the VPS IP, then restart Caddy so ACME can issue a cert.

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
