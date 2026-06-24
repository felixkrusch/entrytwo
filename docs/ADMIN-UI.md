# Admin UI & User Management

This document describes the current and planned Admin UI for entrytwo.

---

## Goals

- Allow an **ADMIN** to manage users and roles.
- Allow configuration of global settings (company name, base currency, default tax jurisdiction, etc.).
- Provide a safe first-admin bootstrap flow on fresh installations.
- Keep everything auditable.

---

## Current State (2026-06-24)

### Schema

`prisma/schema.prisma` already defines:

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

`Setting` model now exists (for company/global configuration).

### Application (Implemented)

- Full **Admin UI** exists at `app/app/AdminPanel.tsx` (always rendered in the main layout).
- Current features:
  - List users (email, name, role, createdAt)
  - Create users (email + optional name + role)
  - Inline role changes (ADMIN / ACCOUNTANT / VIEWER)
  - Delete users (audited)
  - Live company settings:
    - Company name (`company.name`)
    - Base currency
    - Default tax jurisdiction
- All admin actions create `Event` audit records.
- **First-admin bootstrap**:
  - `GET /api/bootstrap/status` returns `{ needsBootstrap: true }` when zero ADMIN users exist.
  - On fresh DB, the right panel is replaced by a prominent "Create First Admin" form (AdminPanel in bootstrap mode).
  - Creating the first ADMIN immediately unlocks the full application.
- After bootstrap, the normal AdminPanel + full chat/panels UI is shown.

### Chat Lock

A "Chat Lock (advisory-only)" toggle already exists in the chat interface as a deliberate safety control.

---

## Current vs Planned (Updated 2026-06-24)

Most of the "Planned Admin UI" below is now **implemented**:

### Implemented (Current)

- Users list / create / change role / delete (with audit)
- Company settings (name, base currency, default jurisdiction) via `Setting` model
- First-admin bootstrap gate (blocks entire app until first ADMIN is created)
- AdminPanel always visible (during bootstrap and after)

### Still Planned / Future

- Explicit "Admin" navigation link (currently always shown in the panel list)
- Role-based visibility (hide AdminPanel for non-ADMINS in later phases)
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

## Data Model Additions (Planned)

```prisma
model Setting {
  id        String   @id @default(uuid())
  key       String   @unique
  value     Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Or a more structured `Company` model if we prefer strong typing later.

---

## Security & Audit

- All user creation / role changes must create an `Event` record.
- Sensitive actions (role elevation to ADMIN) should be extra visible in the audit log.
- In later phases: require re-auth / TOTP for ADMIN actions.

---

## Current vs Target (Updated)

| Area                    | Current (2026-06-24)                          | Target |
|-------------------------|-----------------------------------------------|--------|
| User model              | Exists (`User` + `Role`)                      | Done + bootstrap flow |
| Admin UI                | Full AdminPanel (users + settings + bootstrap) | Keep + polish (role visibility, navigation) |
| User management         | Create / list / change role / delete (audited) | Done |
| Company settings        | Live via `Setting` model                      | Done (expand later) |
| First admin bootstrap   | Implemented (gate + prominent form)           | Done |
| Audit for admin actions | `Event` records created on all changes        | Done (more types later) |

---

## Next Steps (Historical)

The items below were the original plan. As of 2026-06-24 they are **largely complete**:

1. ~~Add `Setting` model + migration~~ Done
2. ~~Create `AdminPanel.tsx`~~ Done (always rendered)
3. ~~Implement list/create/change-role + settings~~ Done
4. ~~Implement first-admin bootstrap gate~~ Done (blocks UI + prominent form)
5. Wire role-based visibility / top nav link (future polish)
6. Update docs + seed (done, seed includes default settings)

Future work is tracked in Phase 2+ docs.

---

## Related Documents

- `docs/Implementation-Plan.md`
- `docs/Project-Scope-Architecture.md`
- `docs/SETUP.md`
- `docs/Security-Compliance.md`
- `prisma/schema.prisma`
