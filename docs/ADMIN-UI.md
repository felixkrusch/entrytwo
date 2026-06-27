# Admin UI & User Management

This document describes the current and planned Admin UI for entrytwo.

---

## Goals

- Allow an **ADMIN** to manage users and roles.
- Allow configuration of global settings (company name, base currency, default tax jurisdiction, etc.).
- Provide a safe first-admin bootstrap flow on fresh installations.
- Keep everything auditable.

---

## Current State (2026-06-27)

### Schema

`prisma/schema.prisma` defines:

```prisma
enum Role {
  ADMIN
  ACCOUNTANT
  VIEWER
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  role      Role     @default(ADMIN)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    Event[]
}
```

`Setting` model exists (for company/global configuration).

### Application (Implemented)

- Full **Admin UI** exists at `app/app/AdminPanel.tsx` (always rendered in the main layout).
- **Admin Routes** (`/admin/*`):
  - `/admin` - Overview with quick links
  - `/admin/company` - Company settings (name, country, currency, tax jurisdiction)
  - `/admin/users` - User management
  - `/admin/ai` - AI/LLM provider configuration
  - `/admin/reports` - **Balance Sheet and Profit & Loss statements with date filters**
  - `/admin/bank-feeds` - Bank feed connections (Stripe, PayPal)
  - `/admin/backup` - Data export/import

- Current features:
  - List users (email, name, role, createdAt)
  - Create users (email + optional name + role)
  - Inline role changes (ADMIN / ACCOUNTANT / VIEWER)
  - Delete users (audited)
  - Live company settings:
    - Company name (`company.name`)
    - Country with region selector
    - Base currency
    - Default tax jurisdiction
  - **Reports page with date range filters and tax summary**
  - All admin actions create `Event` audit records.

- **First-admin bootstrap**:
  - `GET /api/bootstrap/status` returns `{ needsBootstrap: true }` when zero ADMIN users exist.
  - On fresh DB, the right panel shows a "Create First Admin" form (basic or advanced onboarding).
  - Creating the first ADMIN immediately unlocks the full application.

- **Advanced Onboarding** (new):
  - Option during bootstrap to set up company name, country, currency, and default accounts
  - Creates standard chart of accounts automatically

### Reports UX

The **Reports page** (`/admin/reports`) provides:

- **Date range filtering** - Filter Profit & Loss by date range
- **Balance Sheet** - Assets, Liabilities, Equity with totals and balance check
- **Profit & Loss** - Revenue, expenses, net income with tax summary
- **Multi-currency support** - Native currency breakdown where available
- **Tax summary** - Input/output/net tax amounts for applicable periods

Reports are also accessible in the main app via the right panel (live view).

---

## Current vs Planned (Updated 2026-06-24)

Most of the "Planned Admin UI" below is now **implemented**:

### Implemented (Current)

- Users list / create / change role / delete (with audit)
- Company settings (name, base currency, default jurisdiction) via `Setting` model
- First-admin bootstrap gate (blocks entire app until first ADMIN is created)
- AdminPanel always visible (during bootstrap and after)
- **Reports page with date filters**
- **Bank feeds admin UI**
- **Backup & export page**

### Still Planned / Future

- Role-based visibility (hide admin sections for non-ADMINS in later phases)
- TOTP / stronger protection for ADMIN actions
- More settings (fiscal year, default accounts, etc.)

---

## Planned Admin UI (Original Spec — kept for reference)

### 1. Access

- Only users with `role = ADMIN` can access the Admin section.
- Will be reachable from a top-level navigation item ("Admin") or from a user menu.

### 2. Sections

#### Users

- List all users (email, name, role, createdAt)
- Create new user (email + name + role)
- Change role (ADMIN / ACCOUNTANT / VIEWER)
- Deactivate / delete (with audit)

#### Settings (Company / Global)

- Company / legal name
- Base currency (default: `EUR`)
- Default tax jurisdiction (for suggestions)
- Fiscal year start (month/day)
- Other future preferences

Stored in the `Setting` model.

#### Audit (Admin View)

- Quick view of recent `Event` records
- Link to full AuditLogPanel

### 3. First Admin Bootstrap

On a completely fresh database (no `User` with `role = ADMIN`):

1. Show a "Create First Admin" form instead of (or before) the normal chat UI.
2. The created user gets `role = ADMIN`.
3. After creation, normal UI is unlocked.
4. This flow is only available once.

(This is now implemented.)

---

## Data Model

```prisma
model Setting {
  id        String   @id @default(uuid())
  key       String   @unique
  value     Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## Security & Audit

- All user creation / role changes must create an `Event` record.
- Sensitive actions (role elevation to ADMIN) should be extra visible in the audit log.
- TOTP 2FA can be enabled via the AdminPanel for additional security.

---

## Current vs Target (Updated)

| Area                    | Current (2026-06-27)                                    | Target |
|-------------------------|---------------------------------------------------------|--------|
| User model              | Exists (`User` + `Role`)                      | Done + bootstrap flow |
| Admin UI                | Full AdminPanel (users + settings + bootstrap) | Done |
| User management         | Create / list / change role / delete (audited) | Done |
| Company settings        | Live via `Setting` model                      | Done (expand later) |
| First admin bootstrap   | Implemented (gate + prominent form)           | Done |
| Audit for admin actions | `Event` records created on all changes        | Done (more types later) |
| Reports UX              | `/admin/reports` with date filters            | Done |
| Bank feeds              | `/admin/bank-feeds` with connections UI       | Done |

---

## Related Documents

- `docs/Implementation-Plan.md`
- `docs/Project-Scope-Architecture.md`
- `docs/SETUP.md`
- `docs/Security-Compliance.md`
- `prisma/schema.prisma`