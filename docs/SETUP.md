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

# Auth (future)
AUTH_SECRET="change-this-in-production"

# LLM keys (optional for Phase 1+)
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
XAI_API_KEY=""
```

> **Note:** The current implementation does not yet enforce auth in the UI for local development. This will be added as part of the Admin UI work.

---

## 4. Database

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

## 5. First Admin Bootstrap (Important)

entrytwo is designed so that the very first user created in a fresh installation becomes an **ADMIN**.

Current behavior (development):
- If no `User` with role `ADMIN` exists, the system allows creating the first admin via a simple form (this will be surfaced in the Admin UI).
- Subsequent users can be created with roles `ADMIN`, `ACCOUNTANT`, or `VIEWER`.

In production this flow will be protected and usually triggered during initial onboarding.

---

## 6. Running the Application

```bash
npm run dev
```

- Chat interface is on the left.
- Dynamic panels (accounts, journal, reports, P&L, audit) on the right.
- Upload PDF button is in the top bar.

---

## 7. Docker (Full Stack)

```bash
docker compose up --build
```

This will start the Next.js app + Postgres. Adjust ports in `compose.yaml` / `compose.debug.yaml` as needed.

---

## 8. Common Commands

```bash
# Database
npx prisma studio                 # Browse data
npx prisma migrate reset          # Danger: resets DB
npm run db:seed                   # Re-seed

# Code quality
npm run build
npm run lint

# Production
npm run build
npm start
```

---

## 9. First Time Checklist

- [ ] Database is running and `DATABASE_URL` is correct
- [ ] `npx prisma migrate dev` succeeded
- [ ] Seed completed (`npm run db:seed`)
- [ ] First ADMIN user created
- [ ] You can see the chart of accounts and create a manual journal entry
- [ ] You can upload a PDF and get a suggestion with currency + tax (if detected)

---

## 10. Production Considerations (Later Phases)

- Use a strong `AUTH_SECRET`
- Enable HTTPS
- Set up proper email delivery for magic links
- Use a managed Postgres (or well-secured self-hosted)
- Regular backups
- Add 2FA / TOTP for ADMIN accounts
- Consider read replicas for reporting

---

## 11. Troubleshooting

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

This guide will be kept up to date as the Admin UI, authentication, and deployment stories mature.
