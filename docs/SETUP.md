# entrytwo - Setup & Deployment Guide

This guide walks you through getting a local development instance of entrytwo running from scratch, including the database, seeding, and creating your first admin user.

---

## 1. Prerequisites

- Node.js 22 LTS and npm
- PostgreSQL 16 (local or via Docker)
- Git

Optional but recommended:
- Docker & Docker Compose (for the included compose files)

---

## 2. Quick Start (two supported paths)

entrytwo can be installed either **from source** (clone + npm) or **from Docker** (pull image + compose). Choose whichever fits your workflow:

### Option A — Git / npm (developers, AI coding enthusiasts)

Best for: developers, AI coding enthusiasts, customization.

Installation: clone, install dependencies, configure, run.
Updates: back up, review and select a source revision, then rebuild/migrate.
Customization: full source access.
Provide a reachable PostgreSQL database separately. The included Compose `db`
service does not publish a host port for a native Node.js app.

```bash
# 1. Clone
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo

# 2. Install dependencies
npm ci

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY,
# JOB_RUNNER_SECRET, and your LLM provider/key.

# 4. Start PostgreSQL (choose one)

# Option A: loopback-only development container matching .env.example
docker run --name entrytwo-dev-db \
  -e POSTGRES_USER=entrytwo \
  -e POSTGRES_PASSWORD=entrytwo_dev_password \
  -e POSTGRES_DB=entrytwo \
  -p 127.0.0.1:5432:5432 \
  -v entrytwo_dev_postgres:/var/lib/postgresql/data \
  -d postgres:16-alpine

# Option B: Local Postgres
# Make sure you have a database called "entrytwo" and update DATABASE_URL accordingly.

# 5. Wait for PostgreSQL, generate the client, and apply committed migrations
npx prisma generate
npx prisma migrate deploy

# 6. Start the app
npm run dev
```

Open http://localhost:3000

The example database password is for local development only. If PostgreSQL is
already running, skip the example container and configure its connection URL.
The bundled Compose database does not publish a host port; `docker compose up
-d db` alone cannot serve a native Node.js app. Generate each secret separately
with `openssl rand -hex 32`. Complete company onboarding to initialize accounts.

**Never seed a real installation.** `npx prisma db seed` truncates application
tables before inserting sample data. It is only for disposable development
databases, not a normal installation or update step.

### Option B — Docker / Compose (self-hosters, businesses, server administrators)

Best for: self-hosters, businesses, server administrators.

Installation: pull image, configure, start.
Updates: pull new image + migrate/restart.
Customization: usually configuration-based.
Database and Redis: included in Compose.

```bash
# 1. Create a fresh directory
mkdir entrytwo && cd entrytwo

# 2. Download public installation files
RELEASE_URL=https://github.com/felixkrusch/entrytwo-releases/releases/latest/download
curl -fL "$RELEASE_URL/compose.yaml" -o compose.yaml
curl -fL "$RELEASE_URL/entrytwo.env.example" -o .env.example

# 3. Copy and edit environment
umask 077
cp .env.example .env
# Edit .env — set DATABASE_URL, POSTGRES_PASSWORD, AUTH_SECRET, ENCRYPTION_KEY,
# JOB_RUNNER_SECRET, AUTH_URL, AUTH_TRUST_HOST=true, SMTP/OAuth, LLM keys, etc.

# 4. Validate, pull, and start
docker compose config --quiet
docker compose pull
docker compose up -d

# Migrations run automatically. Bootstrap the initial admin in the browser.
```

Open your configured HTTPS `AUTH_URL`. For localhost-only Docker labs, set
`AUTH_URL=http://localhost:3000` and explicitly enable `AUTH_ALLOW_HTTP=true`.
Never use that exception on a public server. Docker runs production mode even
locally, so real SMTP/OAuth and administrator TOTP are required.

On first visit you should be able to create the initial **ADMIN** user if none exists (see "First Admin Bootstrap" below).

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/entrytwo"
DATABASE_URL_TEST="postgresql://user:password@localhost:5432/entrytwo_test"

# Auth.js
AUTH_SECRET="" # generate separately with openssl rand -hex 32
JOB_RUNNER_SECRET="" # generate separately with openssl rand -hex 32

# Email for Magic Link
# SMTP (works with any SMTP server)
SMTP_HOST=""       # smtp.gmail.com, etc.
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="noreply@yourdomain.com"

# OAuth providers (optional) — Google and/or Microsoft Entra ID
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
MICROSOFT_ENTRA_ID_ID=""
MICROSOFT_ENTRA_ID_SECRET=""
MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/common/v2.0"
AUTH_URL="http://localhost:3000"

# Bank feed encryption (required for storing provider credentials)
ENCRYPTION_KEY=""  # 64 hex characters (32 bytes)

# Stripe webhook verification (only if enabling the Stripe feed)
STRIPE_SECRET_KEY=""
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
2. Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env`.
3. Create a webhook pointing to `https://yourdomain.com/api/webhooks/paypal`.
4. Set the resulting webhook ID as `PAYPAL_WEBHOOK_ID`.

Stripe and PayPal are the only supported live processor feeds. Other bank and card data is imported by uploading statements or transaction tables through chat.

---

## 5. Database

### Database Access: Host vs Container

The included Compose stack connects its app and worker to `db:5432` privately.
It does not expose PostgreSQL on the host. For the native Node.js path, use
the loopback-bound `docker run` example in Section 2 or a separate PostgreSQL
server. Do not start the full Compose app just to obtain a host database.

### Manual Postgres

Create a database:

```sql
CREATE USER entrytwo WITH PASSWORD 'entrytwo_dev_password';
CREATE DATABASE entrytwo OWNER entrytwo;
```

Run the SQL as a PostgreSQL administrator. Ownership gives the application
role the schema permissions needed for migrations. The password is a local
development example only. Then set:

```env
DATABASE_URL="postgresql://entrytwo:entrytwo_dev_password@localhost:5432/entrytwo"
```

### Migrations

```bash
npx prisma generate
npx prisma migrate deploy
```

Apply committed migrations with `migrate deploy`; use `migrate dev` only when
developing schema changes.

### Seeding (Disposable Development Databases Only)

The seed **truncates existing application tables**, then creates:
- Standard chart of accounts
- Common tax rates (DE 19%/7%, AT 20%, US-CA 8.25%)
- A few sample contacts

```bash
npx prisma db seed
```

Do not run this on an installation containing real data. Initial company
onboarding supplies the chart of accounts; seeding is not required to install.

---

## 6. First Admin Bootstrap (Important)

entrytwo is designed so that the very first user created in a fresh installation becomes an **ADMIN**.

- The first sign-in bootstraps the initial administrator; complete company
  onboarding to set language, company details, and the standard chart of accounts.
- Subsequent users need invitations and must sign in with the invited email.
- Roles are `ADMIN`, `ACCOUNTANT`, and `VIEWER`.
- Production administrators must enroll TOTP before using the app. Instant
  developer email login is unavailable in production, including Docker.

---

## 7. Running the Application

```bash
npm run dev
```

For native background jobs, start a second process with the same environment:

```bash
node --env-file=.env scripts/job-worker.mjs
```

Keep the worker running for invoice email jobs; configure SMTP for delivery
even when OAuth handles sign-in.

- Chat interface is on the left.
- Dynamic panels (accounts, journal, reports, P&L, audit) on the right.
- Upload PDF button is in the top bar.

---

## 8. Docker (Full Stack)

Two supported install paths:

### Build a Docker Image From Source

Best for: developers, AI coding enthusiasts, customization.

```bash
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo
cp .env.example .env   # edit secrets, AUTH_URL, SMTP/OAuth, POSTGRES_PASSWORD
docker compose up -d --build
# app entrypoint runs: prisma migrate deploy, then next start
```

### Path B — Docker Compose pull (pull published image, no clone)

Best for: self-hosters, businesses, server administrators.

```bash
mkdir entrytwo && cd entrytwo

RELEASE_URL=https://github.com/felixkrusch/entrytwo-releases/releases/latest/download
curl -fL "$RELEASE_URL/compose.yaml" -o compose.yaml
curl -fL "$RELEASE_URL/entrytwo.env.example" -o .env.example

umask 077
cp .env.example .env
# edit .env — fill secrets, AUTH_URL, SMTP or OAuth, POSTGRES_PASSWORD

docker compose config --quiet
docker compose pull
docker compose up -d
```

# app entrypoint runs: prisma migrate deploy, then next start

Use your configured HTTPS origin, or the explicit localhost-only HTTP exception
described in Section 2. This is production mode, not native `npm run dev`.

On first visit you should be able to create the initial **ADMIN** user if none exists (see "First Admin Bootstrap" below).

---

## 9. Common Commands

```bash
# Database
npx prisma studio                 # Browse data

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
- [ ] `npx prisma generate` and `npx prisma migrate deploy` succeeded
- [ ] Company onboarding completed; no destructive seed used
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

**Seed fails or unique constraint errors**
- Do not reset or seed a database with real records. Investigate the specific
  error and migrations first. Only discard a disposable development database
  after explicitly confirming it contains no data that must be retained.

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
