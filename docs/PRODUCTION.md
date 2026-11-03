# Production deploy — entrytwo

Self-hosted double-entry accounting. Use this after local setup works; for auth go-live details see [VPS-Auth-Install.md](./VPS-Auth-Install.md).

## Prerequisites (do these first)

| Item | Why |
|------|-----|
| VPS with **≥ 2 GB RAM** (4 GB if you also run other apps on the same host) | Next.js build + Postgres + worker |
| SSH access as root (or sudo) with a **key on the server** | Project SSH keys in Hetzner/DO are **not** auto-installed on existing VMs |
| Domain **A record** → server IPv4 | Let’s Encrypt / Caddy need public DNS **before** HTTPS works |
| **SMTP** (all of HOST/USER/PASS) and/or **Google/Microsoft OAuth** | Production **refuses to start** without a real sign-in method |
| Fresh secrets per install | Never reuse lab keys |

Generate secrets:

```bash
openssl rand -base64 48   # AUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY
openssl rand -base64 48   # JOB_RUNNER_SECRET
openssl rand -base64 48   # UPDATER_TOKEN (if using compose updater sidecar)
openssl rand -base64 24   # POSTGRES_PASSWORD
```

## Required environment

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | PostgreSQL (compose sets this from `POSTGRES_PASSWORD`) |
| `POSTGRES_PASSWORD` | Required by `compose.yaml` |
| `AUTH_SECRET` | ≥ 32 chars |
| `ENCRYPTION_KEY` | 64 hex chars |
| `JOB_RUNNER_SECRET` | ≥ 32 chars |
| `AUTH_URL` | Public origin, e.g. `https://books.example.com` (no trailing slash) |
| `AUTH_TRUST_HOST` | `true` behind Caddy/nginx/Traefik |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Magic links + invites (or use OAuth instead) |
| `SMTP_FROM` | Recommended |
| `UPDATER_TOKEN` | Required when `UPDATER_URL` is set (default compose starts the updater) |

`/api/auth/dev` (instant email) is **disabled** in production.

## Docker deploy (single host)

### Primary: Pull published image from GHCR (no clone needed)

Use the maintained public installation instructions at
https://entrytwo.com/docs/getting-started/installation. Download `compose.yaml`
and `.env.example` from https://github.com/felixkrusch/entrytwo-releases/releases.
These assets include the separate updater image, worker, and verification defaults.

The repo is private. Run the published image directly — built and signed on every `v*` tag:

```bash
mkdir entrytwo && cd entrytwo

RELEASE_URL=https://github.com/felixkrusch/entrytwo-releases/releases/latest/download
curl -fL "$RELEASE_URL/compose.yaml" -o compose.yaml
curl -fL "$RELEASE_URL/entrytwo.env.example" -o .env.example

umask 077
cp .env.example .env
# edit .env — fill secrets, AUTH_URL, SMTP or OAuth, POSTGRES_PASSWORD
# Keep the supplied COSIGN_IDENTITY and UPDATE_MANIFEST_URL.

docker compose config --quiet
docker compose pull
docker compose up -d

# app entrypoint runs: prisma migrate deploy, then next start

curl -sS https://your.domain/api/health
# expect: "ready": true, "status": "ok", auth.productionReady: true

```

Open the site → bootstrap first **ADMIN** → complete **TOTP** → company settings.
Always run Compose from the installation directory. The updater mounts that
directory at its host path so Docker resolves bind mounts correctly. Its Docker
socket access is privileged; keep the sidecar port private. For local HTTP-only
use, set `AUTH_ALLOW_HTTP=true`; public deployments must use HTTPS. The app port
binds to `127.0.0.1` by default for a host reverse proxy.
### Build notes (image packaging)

- `docker build` needs a placeholder `AUTH_SECRET` at **build** time (set in the Dockerfile). Runtime must override with a real secret via `.env`.
- The image includes `prisma/` **and** `prisma.config.ts` (Prisma 7). Without the config file, `prisma migrate deploy` fails with “datasource.url property is required”.
- Entrypoint writes a short `.env` with `DATABASE_URL` before migrate so Prisma’s dotenv loader sees the URL.
- Entrypoint creates `.data/`, `uploads/`, `logs/`, `backups/` so health storage checks pass.
- `UPDATER_TOKEN` is only mandatory when `UPDATER_URL` is set. Omit updater for a minimal stack (custom compose without the sidecar).

## Reverse proxy + TLS (Caddy example)

```caddyfile
books.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

- Point DNS **A** record at the VPS **before** expecting HTTPS. If DNS is missing, ACME fails and browsers show TLS errors (`SSL_ERROR_INTERNAL_ERROR_ALERT`, etc.).
- After DNS propagates, restart Caddy if certs were attempted too early: `systemctl restart caddy`.
- Set `AUTH_URL=https://books.example.com` and `AUTH_TRUST_HOST=true`.
- Do not expose Postgres publicly. Firewall: 22, 80, 443 only.

### DNS (Squarespace / typical UI)

Zone `example.com` → Type **A**, Name **`books`** (not the FQDN), Data = server IP → `books.example.com`.

## Worker

Background email/webhooks need the **worker** process (`docker compose` service `worker`, or `npm run worker`). Without it, durable jobs stay pending.

## Multi-instance on one VPS

Running several installs (e.g. personal + demo) on one machine:

1. Separate directories / compose **project names** (`-p accounting`, `-p demo1`).
2. Separate Postgres volumes and `.env` (unique secrets and `AUTH_URL` per hostname).
3. Different host ports (`3001`, `3002`, …) and one reverse proxy routing by hostname.
4. Budget **~1–1.5 GB RAM per full stack** (app + worker + Postgres); 4 GB is comfortable for two light installs.
5. Prefer **one image build** reused by multiple compose projects (`image: entrytwo:latest`).

## Smoke test

1. `GET /api/health` → `ready: true`
2. Magic link or OAuth sign-in on the public HTTPS URL
3. Admin TOTP setup
4. Create a journal entry / contact as appropriate
5. Admin → Backup export (if used)
6. Invite a second user (optional)

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `AUTH_SECRET is required in production` during **build** | Dockerfile must set a build-time placeholder (fixed in current Dockerfile) |
| `datasource.url property is required` on migrate | Missing `prisma.config.ts` in image or empty `DATABASE_URL` |
| `UPDATER_TOKEN must be configured` | Set token, or clear `UPDATER_URL` and drop updater service |
| Production boot: “Configure at least one production sign-in method” | Set full SMTP or OAuth |
| `Nodemailer requires a server configuration` | App must pass `server: { host, port, auth }` to Auth.js Email provider (fixed in current code) |
| Health `storage: unreachable` | Writable `.data` / uploads dirs (entrypoint creates them) |
| Browser TLS internal error | DNS not pointing at server yet, or Caddy failed ACME — fix DNS, restart Caddy |
| SSH “Permission denied (publickey)” | Key exists in cloud console but not in `/root/.ssh/authorized_keys` on the VM |

## Related

- [VPS-Auth-Install.md](./VPS-Auth-Install.md) — auth smoke table
- [SETUP.md](./SETUP.md) — local development
- [Self-Hosted-Update-Delivery.md](./Self-Hosted-Update-Delivery.md) — signed image updates
