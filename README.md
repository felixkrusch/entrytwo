# entrytwo

**AI-native double-entry accounting.** Chat-first, fully internationalized, tax-aware from day one, and multi-currency with authoritative bank/credit card feed rates.

- **Core**: Proper double-entry with audit logging.
- **i18n**: 100% externalized strings, locale-aware formatting (no hardcoded English).
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
- [docs/Implementation-Plan.md](./docs/Implementation-Plan.md)
- [docs/Project-Scope-Architecture.md](./docs/Project-Scope-Architecture.md)
- [docs/Detailed-Data-Model-Prisma-Schema.md](./docs/Detailed-Data-Model-Prisma-Schema.md)
- [docs/Technical-Architecture.md](./docs/Technical-Architecture.md)
- [docs/Security-Compliance.md](./docs/Security-Compliance.md)

---

## Current Status (2026-06-24)

**Phase 0 foundations are complete** (no technical debt allowed on these):

- Full i18n (next-intl) across UI, chat, modals, reports. Zero hardcoded English.
- Tax foundation live: `TaxRate` + `taxRateId` on lines + live selector + tax-aware P&L.
- Multi-currency foundation:
  - `JournalLine`: `currency`, `fxRateToBase`, `fxSource`, `fxDate`
  - Bank/credit card feed rates are authoritative
  - Automatic date-pinned conversion to base
  - Public FX fallbacks documented (ECB, Bank of Canada, etc.)
  - PDF uploads must extract currency and cross-check feeds; chat must ask for confirmation when uncertain
- Chat Lock (advisory-only safety mode)
- PDF processing extracts currency + tax hints + cross-checks feeds and returns FX + tax enriched suggestions
- Reports (P&L + Balance Sheet) are FX-aware and show per-currency native/base subtotals + feed flags
- Dedicated feed import endpoint for authoritative `BANK_FEED:...` entries
- Richer currency breakdown in reports + UI

**Next major areas (see docs + this session):**
- Proper Setup & Deployment experience (README + `docs/SETUP.md`)
- Admin UI + User management + Settings (company, base currency, etc.)
- First-admin bootstrap flow
- Continue with Phase 1 AI agent work on top of the solid foundation

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
