---
name: entrytwo
description: Install and verify entrytwo from a public source clone or signed Docker images, without seeding or overwriting real records. Use for native Git/npm setup, local onboarding checks, and self-hosted operations.
---

# entrytwo Installation

Read `README.md`, `docs/SETUP.md`, and `LICENSE` from the repository root.
Treat source as proprietary source-available shareware, not open source.
Use one database per company. Obtain human approval for purchases; never
complete checkout, expose secrets, or bypass paid activation.

## Native Git / npm

Use Git, npm, Node.js 22.12+ (22.x) or 24.x, and PostgreSQL 16. Install Node
from https://nodejs.org/en/download, or use an existing nvm installation:

```bash
nvm install
nvm use
node --version
npm ci
cp .env.example .env
```

Do not overwrite an existing `.env`. Generate each secret separately with
`openssl rand -hex 32`: AUTH_SECRET, JOB_RUNNER_SECRET, and ENCRYPTION_KEY.
The encryption key must be exactly 64 hex characters and must survive restores.
Configure a reachable DATABASE_URL; the Compose `db` service has no host port.
Use the loopback-only development database example in README/SETUP if needed.
Bound readiness waits, report logs on failure, and never delete someone else's
database or container to resolve a port conflict.

For xAI, set NEXT_LLM_PROVIDER=xai, XAI_API_KEY, and NEXT_LLM_MODEL to a valid
model enabled for the account. Leave NEXT_LLM_BASE_URL empty for direct xAI.

```bash
npx prisma generate
npx prisma migrate deploy
mkdir -p .data/files .data/backups
npm run dev
```

The application also initializes private directories automatically and fails
startup on inaccessible storage. Keep generated data and secrets uncommitted.
Apply committed migrations; use migrate dev only when developing schema changes.
Never seed or reset an installation containing records. Onboarding creates accounts.
Do not run npm audit fix or upgrade packages as an installation step. Keep the
lockfile; Prisma's update banner is informational.

## Verify Before Handoff

```bash
curl --fail-with-body http://localhost:3000/api/health
node scripts/check-install.mjs http://localhost:3000
```

For an intentionally fresh local development installation only, obtain the
owner's email/company details and bootstrap before logging in:

```bash
node scripts/check-install.mjs http://localhost:3000 --bootstrap --email you@example.com --company "My Company"
```

This creates company/admin records, checks development providers first, refuses
existing administrators, then verifies the ADMIN session with cookies held only
in memory. It is not a production setup/login path. For normal use, let a human
complete browser onboarding and sign-in. Never log or commit a session cookie.

Run background jobs with the same environment:

```bash
node --env-file=.env scripts/job-worker.mjs
```

Confirm the startup line and absence of request errors. SMTP is required for
real invoice email; instant developer sign-in does not deliver mail.

## Production / Docker

Follow `docs/PRODUCTION.md`, `docs/VPS-Auth-Install.md`, and the public guide at
https://entrytwo.com/docs/getting-started/installation. Use signed public release
assets or build the included Dockerfile. Configure HTTPS, strong independent
secrets, SMTP/OAuth, administrator TOTP, persistent storage, and off-host backups.
Docker uses production authentication even on a laptop. Keep dev login disabled.
Never expose the updater socket/token or use down -v on a real installation.

Trial lasts 30 days. Human purchasers obtain a product-bound entrytwo key at
https://entrytwo.com/buy and activate via the app. One license covers owned
businesses; unrelated customers need their own licenses. Private source changes
do not authorize unrestricted redistribution or separately marketed hosting.
