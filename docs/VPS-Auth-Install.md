# VPS install checklist — Auth (OAuth + magic link)

**Status:** Auth is production-capable in code (2026-07-25). Mark an install ready for real users only after the smoke table on **that** host is green.

Use this before pointing real users at a VPS install. Local `npm run dev` is **not** the production path (instant email is disabled in production).

## Ready when all of these are true

1. `NODE_ENV=production` and `npm run build && npm start` (or Docker) succeed; migrations applied (`npx prisma migrate deploy`).
2. `GET /api/health` returns `"ready": true` and `auth.productionReady: true`.
3. At least one real sign-in method works end-to-end on the public HTTPS URL:
   - Google OAuth, and/or
   - Microsoft Entra ID OAuth, and/or
   - SMTP magic link
4. First admin bootstrap completed; admin completed TOTP setup (enforced for ADMIN in production).
5. Invite → accept → sign-in works for a second user with the **exact** invited email.
6. Settings (gear) menu → **Sign out** returns to `/auth/signin` and clears the session.

## Required environment

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
AUTH_SECRET=<openssl rand -base64 48>   # ≥ 32 chars
ENCRYPTION_KEY=<openssl rand -hex 32>   # 64 hex
JOB_RUNNER_SECRET=<openssl rand -base64 48>

# Public origin (no trailing slash). Used for OAuth callbacks + emails.
AUTH_URL=https://books.example.com
APP_PUBLIC_URL=https://books.example.com
AUTH_TRUST_HOST=true   # required behind nginx/caddy/traefik

# At least one of: full SMTP and/or Google and/or Microsoft
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@example.com

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

MICROSOFT_ENTRA_ID_ID=...
MICROSOFT_ENTRA_ID_SECRET=...
MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
```

Lab-only HTTP: `AUTH_ALLOW_HTTP=true` (do not use on the public internet).

## OAuth redirect URIs

Register exactly:

- `https://books.example.com/api/auth/callback/google`
- `https://books.example.com/api/auth/callback/microsoft-entra-id`

## Reverse proxy

- Terminate TLS at the proxy; forward `Host`, `X-Forwarded-Proto=https`, `X-Forwarded-For`.
- App listens on localhost; only 443 is public.
- Keep `AUTH_TRUST_HOST=true` so Auth.js accepts the public host.

## Smoke tests (do these on the VPS)

| # | Test | Pass criteria |
|---|------|----------------|
| 1 | Open `/auth/signin` | Google and/or Microsoft buttons appear if configured; no “dev Continue” as the only path |
| 2 | Existing admin OAuth/magic | Lands in `/app` (then TOTP if enabled) |
| 3 | Invite `user@domain` | Email or link works; OAuth with **same** email creates user with invited role |
| 4 | OAuth with **wrong** email | Denied (`AccessDenied`); no user created |
| 5 | Magic link twice | Second click fails / expired |
| 6 | Disable user | Sign-in denied |
| 7 | `/api/auth/dev` | **403** in production |
| 8 | `/api/health` | `ready: true`, `auth.productionReady: true` |
| 9 | Settings → Sign out | Session cleared; redirected to sign-in |

## Security model (summary)

- New users after bootstrap need an **active invitation** whose email **exactly matches** the OAuth/magic identity (case-insensitive).
- Google requires `email_verified` when the claim is present.
- Dev credentials and `/api/auth/dev` are **not** available in production.
- Sessions are JWT, 7-day max age, httpOnly + Secure cookies in production; `sessionVersion` invalidates sessions on revoke.
- Magic-link tokens are single-use; prior tokens for the same email are invalidated when a new link is sent.

## Not ready if

- Health is degraded for missing auth method, missing `AUTH_URL`, short `AUTH_SECRET`, or `AUTH_TRUST_HOST` not true.
- You only tested local instant email.
- OAuth apps still point at `localhost`.
- SMTP works for invoices but magic links 500 (check logs / `SMTP_FROM` / AUTH_URL).
- HTTPS fails while DNS still points elsewhere or ACME never completed (fix DNS, restart reverse proxy).

## Docker / packaging reminders

- Production compose needs SMTP or OAuth in `.env` **before** `docker compose up` succeeds on boot checks.
- Migrations run in `docker-entrypoint.sh`; container must have `DATABASE_URL` and `prisma.config.ts` in the image.
- See [PRODUCTION.md](./PRODUCTION.md) for full VPS + multi-instance notes.

When the smoke table is green on the VPS, auth is ready for real users on that install.
