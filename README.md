<p align="center">
  <a href="https://entrytwo.com"><img src="https://entrytwo.com/images/logo.png" alt="entrytwo" width="220"></a>
</p>

<h3 align="center">Self-hosted AI accounting that posts real journal entries.</h3>

<p align="center">
  Double-entry books with a Git-style ledger. Runs on your VPS or locally. Pay once, own it forever.
</p>

<p align="center">
  <a href="https://entrytwo.com">Website</a> ·
  <a href="https://entrytwo.com/docs">Docs</a> ·
  <a href="https://entrytwo.com/docs/getting-started/installation">Install</a> ·
  <a href="https://entrytwo.com/#pricing">Pricing</a>
</p>

<p align="center">
  <a href="https://entrytwo.com"><img src="https://entrytwo.com/images/screenshot-dashboard.webp" alt="entrytwo dashboard" width="900"></a>
</p>

<p align="center"><a href="https://entrytwo.com"><b>Watch the 49-second demo on entrytwo.com</b></a></p>

## What It Is

entrytwo is double-entry accounting with an AI assistant, Trillion, built in. You upload bank and credit card statements, PDFs, CSVs or receipts, or connect Stripe and PayPal. When the AI is confident, it posts balanced, finished journal entries with the reasoning and sources stored on each one. Uncertain items wait for you.

Under the hood the ledger works like Git. Every change is an immutable commit, you can branch to try things safely and merge when ready, and you can see who changed what and when (you or the AI). Nothing is silently overwritten.

- AI that posts, not just suggests, with reasoning and sources on every automatic entry
- Git-style history: commits, branches, merges, blame, point-in-time views, closed periods
- Multi-currency with date-pinned FX, where bank and card feed rates are authoritative
- Stripe and PayPal feeds, plus PDF, CSV, OFX, QIF and image uploads
- Invoicing with PDF and email delivery, expense claims with approval, recurring entries
- Reports: P&L, balance sheet, ledgers, CSV export
- Bring your own LLM: OpenAI, Anthropic, xAI/Grok, or any OpenAI-compatible local model
- Magic-link or Google/Microsoft sign-in, TOTP 2FA for admins, encrypted backups

## Install

There are two supported paths. Full guide: [entrytwo installation](https://entrytwo.com/docs/getting-started/installation).

**Not a terminal person?** Point an AI coding agent (Claude Code, Cursor or similar) at the install guide and this repo and ask it to install entrytwo for you. The docs are written so an agent can follow them. Agent-readable summary: [llms.txt](https://entrytwo.com/llms.txt).

### Docker (Self-Hosters, Businesses, Server Admins)

No clone, no Node.js on the host. Requires Docker and Compose v2 or newer. PostgreSQL and Redis are included.

```bash
mkdir entrytwo && cd entrytwo
RELEASE_URL=https://github.com/felixkrusch/entrytwo-releases/releases/latest/download
curl -fL "$RELEASE_URL/compose.yaml" -o compose.yaml
curl -fL "$RELEASE_URL/entrytwo.env.example" -o .env.example
umask 077
cp .env.example .env
```

Edit `.env` before starting. Set fresh `POSTGRES_PASSWORD`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `JOB_RUNNER_SECRET`, and `UPDATER_TOKEN`; `openssl rand -hex 32` generates a suitable value for each when run separately. Keep `ENCRYPTION_KEY` for future restores. Set `AUTH_URL` to your public HTTPS origin, `AUTH_TRUST_HOST=true`, and configure a complete sign-in method (SMTP and/or Google/Microsoft OAuth). Configure your LLM provider and key for AI features. Keep the release template's signing settings and `LICENSE_VERIFY_URL` intact.

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
```

The containers run in production mode. For a public server, configure an HTTPS reverse proxy to `127.0.0.1:3000` and open your configured `AUTH_URL`. For a localhost-only lab install, use `AUTH_URL=http://localhost:3000` and explicitly set `AUTH_ALLOW_HTTP=true`; never use that exception on the public internet. Real SMTP/OAuth is required even for local production containers.

On first visit, create the admin account, enable TOTP, and complete company onboarding to set up your accounts. Migrations run automatically. Keep the worker running for outbound invoice emails, and configure SMTP if you need email delivery even when using OAuth for sign-in.

### Git / npm (Developers, Customization)

Use Node.js 22 LTS, npm, Git, and PostgreSQL 16. This path runs the web app natively; the database may run locally or in Docker.

```bash
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo
cp .env.example .env
npm ci
```

Edit `.env`: set `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `JOB_RUNNER_SECRET`, and your LLM provider/key. If you need a local development database, this example matches the template's `DATABASE_URL` and binds PostgreSQL to loopback only:

```bash
docker run --name entrytwo-dev-db \
  -e POSTGRES_USER=entrytwo \
  -e POSTGRES_PASSWORD=entrytwo_dev_password \
  -e POSTGRES_DB=entrytwo \
  -p 127.0.0.1:5432:5432 \
  -v entrytwo_dev_postgres:/var/lib/postgresql/data \
  -d postgres:16-alpine
```

The example credentials are for local development only. The repository's Compose `db` service does not publish a host port, so `docker compose up -d db` alone cannot serve a web app running on the host. If you already have PostgreSQL, skip the example container and point `DATABASE_URL` at your database instead. Wait for the database to be ready, then:

```bash
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create the first admin, and complete company onboarding to set up your accounts. Development mode supports instant email sign-in without SMTP. For background email jobs, run `node --env-file=.env scripts/job-worker.mjs` in a separate terminal; actual email delivery still needs SMTP.

**Do not seed a real installation.** `npx prisma db seed` truncates existing application tables before inserting sample data. Use it only on a disposable development database. Use `prisma migrate dev` only when developing schema changes; `migrate deploy` applies the committed migrations.

## Pricing and License

- **30-day free trial**, no card required. Try it on your real bank data first.
- **entrytwo: $129 USD one-time**, subject to checkout pricing and applicable taxes. Security and maintenance updates are included for your purchased major version. Major upgrades are optional paid purchases. Unlimited journal entries and users. No recurring license fee or remote kill switch for an activated perpetual license.
- One license covers installations for businesses you own. Use a separate installation/database per company. Unrelated businesses need their own licenses.
- Optional: priority support and professional installation. See [pricing](https://entrytwo.com/#pricing).

entrytwo is **source-available, not open source**. You can read, clone, build and evaluate the code, and make private modifications under the license. Continued use after the trial needs a one-time license. Redistribution and separately marketed hosted services require permission beyond the rights expressly granted in [LICENSE](./LICENSE).

## Documentation

- [Installation](https://entrytwo.com/docs/getting-started/installation)
- [The Git model for accounting](https://entrytwo.com/docs/concepts/git-model): the idea behind everything, read this first
- [AI autonomy](https://entrytwo.com/docs/ai/ai-autonomy): when the AI posts on its own and when it asks
- [Troubleshooting](https://entrytwo.com/docs/troubleshooting/common-issues)
- In this repo: [setup](./docs/SETUP.md), [production](./docs/PRODUCTION.md), [authentication checklist](./docs/VPS-Auth-Install.md), [software license](./LICENSE)

## Development

```bash
npm run dev                                # start the development web app
node --env-file=.env scripts/job-worker.mjs # background jobs, using the same environment
npm run build
npm test                                   # requires a separate, disposable *_test database
npx prisma studio
```

Integration tests reset their test database. Configure `DATABASE_URL_TEST` for a dedicated database ending in `_test`; never use a database containing real records.

```text
app/          Next.js app: chat + panels UI, API routes
prisma/       schema and seed
messages/     UI strings (i18n)
docs/         architecture and implementation docs
updater/      signed self-hosted update sidecar
```

## About

Built by Felix Krusch, a web developer since 1998, who got tired of fighting accounting software for his own company. entrytwo keeps his real books in production every day.

Questions or bugs: [open an issue](https://github.com/felixkrusch/entrytwo/issues) or [contact us](https://entrytwo.com/contact).
