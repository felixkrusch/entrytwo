# entrytwo

**AI-native double-entry accounting.** Chat-first, fully internationalized, tax-aware from day one, and multi-currency with authoritative bank/credit card feed rates.

- **Core**: Proper double-entry with audit logging.
- **i18n**: 100% externalized strings, locale-aware formatting (no hardcoded English). Currently only the `en` locale ships; locale fallback coverage is not yet verified (add a second locale to test fallback before relying on it).
- **Tax**: Multi-jurisdiction (DE/AT/US-CA etc.), input/output, effective dates, tax-aware reports.
- **Multi-Currency**: JournalLine carries currency + fxRateToBase + fxSource + fxDate. Automatic date-pinned conversion to base. Bank/card feed rates are authoritative.
- **PDF + Chat**: Upload invoices → currency + tax + feed cross-check → suggestions with correct FX + tax metadata.
- **Safety**: Chat Lock (advisory-only mode).

---

## Quick Start

See the full guide: [docs/SETUP.md](./docs/SETUP.md)

```bash
npm install

# Configure DB
cp .env.example .env   # edit DATABASE_URL

# Start Postgres (example)
docker compose up -d

npx prisma migrate dev
npm run db:seed

npm run dev
```

Open http://localhost:3000

On a fresh database, create the first **ADMIN** user (bootstrap flow).

---

## Documentation

- [docs/SETUP.md](./docs/SETUP.md) – Setup, environment, seeding, first admin, Docker, troubleshooting
- [docs/Git-Model-for-Accounting.md](./docs/Git-Model-for-Accounting.md) — **Foundational philosophy** (read this first).
- [docs/Self-Hosted-Update-Delivery.md](./docs/Self-Hosted-Update-Delivery.md) — Signed self-hosted release and update architecture.
- [docs/Licensing-and-Trial.md](./docs/Licensing-and-Trial.md) — 30-day trial, pay-to-own licensing, license key format, entitlement verification, and how the trial transitions into the perpetual + maintenance model.
- [docs/VPS-Auth-Install.md](./docs/VPS-Auth-Install.md) — Production OAuth + magic-link checklist (when the install is ready for real users).

---

## Current Status (2026-07-25)

**Phase 0-2 foundations are complete** (no technical debt allowed on these):

- Full i18n (next-intl) across UI, chat, modals, reports. `en` + `de` ship; company default language + localized standard CoA.
- Tax foundation live: `TaxRate` + `taxRateId` on lines + live selector + tax-aware P&L + Balance Sheet.
- Multi-currency foundation:
  - `JournalLine`: `currency`, `fxRateToBase`, `fxSource`, `fxDate`
  - Bank/credit card feed rates are authoritative (BANK_FEED source)
  - Automatic date-pinned conversion to base currency
  - LLM multi-source web research for provisional FX rates
  - PDF uploads extract currency and cross-check feeds; chat asks for confirmation when uncertain
- Chat Lock (advisory-only safety mode)
- PDF processing extracts currency + tax hints + cross-checks feeds
- Reports (P&L + Balance Sheet) are FX-aware with per-currency subtotals
- Audit log detail view (click events for full payload)
- Transaction templates (save/use/delete recurring patterns)
- Real-time verification in journal modal
- Git Model for Accounting (branches, merge, tags, restore, diff, blame)

**Phase 3:**
- [x] Magic Link authentication (Auth.js + `VerificationToken`; branded SMTP mail; single-use, 30 min)
- [x] RFC 6238 TOTP 2FA with mandatory administrator setup and one-time recovery codes
- [x] OAuth login (Google + Microsoft Entra ID; invitation-gated; invite email must match IdP email)
- [x] Production auth gates (`AUTH_URL`, `AUTH_TRUST_HOST`, ≥1 real method); dev instant login only when `NODE_ENV !== production`
- [x] Sign out from the settings (gear) menu
- [x] Licensing/activation system (30-day trial + pay-to-own; see Licensing-and-Trial.md)
- [x] Data export/import for backup/migration (Admin → Backup)
- [ ] VPS install verified end-to-end with real IdP + SMTP (operator checklist: [VPS-Auth-Install.md](./docs/VPS-Auth-Install.md))

---

## Project Structure (Key Parts)

```
app/
  app/                 # Main hybrid chat + panels UI
  api/                 # journal-entries, chat, invoices/process, reports, tax-rates, fx, feeds/import, ...
prisma/
  schema.prisma
  seed.ts
messages/en.json       # All UI strings
docs/                  # Architecture + implementation docs
```

---

## Common Commands

```bash
npm run dev
npm run build
npx prisma studio
npm run db:seed
npx prisma migrate reset
```

---

## License

To be decided (currently self-hosted / open-source intent).

---

**Important:** i18n, multi-jurisdiction tax, and multi-currency (with feed rates as authoritative) are **non-negotiable foundations**. "We'll add it later" is not acceptable.
