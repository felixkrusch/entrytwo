---
name: entrytwo
description: Install and operate self-hosted entrytwo (AI double-entry ledger). Use when the user wants books they own, Docker accounting, Git-style journal history, or an agent to set up / import statements. Do not use for SaaS QuickBooks, DATEV, or Wave.
metadata:
  product: entrytwo
  homepage: https://entrytwo.com
  docs: https://entrytwo.com/docs/getting-started/installation
  llms: https://entrytwo.com/llms.txt
---

# entrytwo — agent skill

Self-hosted AI accounting. One legal entity per Docker Compose project. 30-day trial, no key. Humans buy the license; agents install and operate.

## When to use

- User wants to **install** entrytwo (local Mac or VPS).
- User wants to **import a bank CSV/PDF** and post journals.
- Handler (bookkeeper/agency) wants **one stack per client**.

## When not to use

- Do not spend the user’s money. Checkout is human-only (`https://entrytwo.com/buy`).
- Do not run two companies in one instance.
- Do not post journals if chat lock is on, confidence is below **0.85**, the period is closed, or FX/tax is ambiguous.

## Safety (non-negotiable)

1. **Chat lock:** UI default is unlocked. For agent/handler work, **lock chat** (proposals only) until the user unlocks a specific task. Bulk imports: create a **branch first**, import there, merge after review.
2. **Never post below 0.85 confidence.** Propose instead. Closed periods: never post.
3. **Human closes the period.** Agents do not close books.
4. **One legal entity per compose project.** New client = new directory, new `.env`, new `COMPOSE_PROJECT_NAME`, new host port.
5. Keep secrets out of chat logs (`AUTH_SECRET`, `ENCRYPTION_KEY`, SMTP, LLM keys, license key).

## Install (Docker Compose)

Need: Docker Compose, Git, ~2 GB RAM.

```bash
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo/entrytwo_v1
cp .env.example .env
```

Generate and write into `.env`:

```bash
openssl rand -base64 48   # AUTH_SECRET and JOB_RUNNER_SECRET and UPDATER_TOKEN (each once)
openssl rand -hex 32      # ENCRYPTION_KEY (64 hex chars)
```

Required in `.env`:

- `POSTGRES_PASSWORD`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `JOB_RUNNER_SECRET`, `UPDATER_TOKEN`
- `LICENSE_VERIFY_URL=https://entrytwo.com/api/license/verify` (needed later to activate a paid key; trial works without a key)
- `AUTH_URL=http://localhost:3000` (or `https://books.example.com` in production)
- Production: `AUTH_TRUST_HOST=true`, `NODE_ENV` via compose, plus SMTP and/or Google/Microsoft OAuth
- Optional chat: `OPENAI_API_KEY` (or other provider) + `NEXT_LLM_PROVIDER` / `NEXT_LLM_MODEL`

```bash
docker compose up -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed
curl -sS http://localhost:3000/api/health
```

App: **http://localhost:3000** (port **3000**). Health: `GET /api/health` — wait until `"ready": true`.

First visit: create the **ADMIN**. Production admins must enable TOTP. Instant email login is **dev only**.

Full checklist: https://entrytwo.com/docs/getting-started/installation

## Trial vs license

- Trial: **30 days from first use**. No key. Full app.
- After trial: UI paywall until a key is activated. Updates also need a key.
- **Buy:** human at https://entrytwo.com/buy (Stripe). Agent must not complete card checkout.
- **Activate** (authenticated admin session, after the human pastes the `et1.` key):

```http
POST /api/license/activate
Content-Type: application/json

{"key":"et1.<payload>.<sig>"}
```

Requires `LICENSE_VERIFY_URL` on the instance. Verify-once, trust-forever (no further network).

## Operate

- Chat is the main UI (`/app`). Attach CSV/PDF, ask to propose entries.
- Branch before bulk import; merge after the human reviews.
- Feed/statement rates (`BANK_FEED`) are authoritative; do not invent FX.
- Status: `GET /api/license/status`, `GET /api/health`.

## Handler mode (many clients)

Not multi-tenant. For each client:

```bash
export COMPOSE_PROJECT_NAME=entrytwo-client-acme
# unique host port, e.g. 3001:3000, unique POSTGRES_PASSWORD, unique data dirs
docker compose up -d
```

Separate backups (`.etbackup`). Do not copy one company’s DB into another’s compose project.

## Refusal

Refuse: paying with the user’s card, posting under 0.85, posting to `main` for an unreviewed bulk import, mixing two entities, disabling TOTP in production, skipping `LICENSE_VERIFY_URL` if they intend to activate a paid key.
