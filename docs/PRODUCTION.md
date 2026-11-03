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

Two ways to run:

### Option A: Build from source (clone the repo)

```bash
git clone https://github.com/felixkrusch/entrytwo.git
cd entrytwo
cp .env.example .env   # edit .env — fill secrets, AUTH_URL, SMTP or OAuth, POSTGRES_PASSWORD
docker compose up -d --build
```

### Option B: Pull published image from GHCR (no clone needed)

Images are built and signed on every `v*` tag and published to `ghcr.io/felixkrusch/entrytwo`.

```bash
mkdir entrytwo && cd entrytwo

# Write a minimal compose.yaml (see SETUP.md §8B for a full template):
cat > compose.yaml <<'EOF'
services:
  app:
    image: ghcr.io/felixkrusch/entrytwo:latest
    restart: unless-stopped
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:?required}@db:5432/entrytwo
      - APP_IMAGE=ghcr.io/felixkrusch/entrytwo:latest
      - UPDATER_URL=http://updater:4000
      - UPDATER_TOKEN=${UPDATER_TOKEN:?required}
    ports:
      - "3000:3000"
    volumes:
      - ./backups:/app/entrytwo/backups
      - ./logs:/app/entrytwo/logs
      - ./uploads:/app/entrytwo/public/uploads
    depends_on:
      db:
        condition: service_healthy
      updater:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5

  updater:
    image: ghcr.io/felixkrusch/entrytwo:latest
    build:
      context: .
      dockerfile: ./updater/Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      - UPDATER_PORT=4000
      - UPDATER_TOKEN=${UPDATER_TOKEN:?required}
      - UPDATE_VERIFY_SIGNATURE=true
      - APP_IMAGE=ghcr.io/felixkrusch/entrytwo:latest
      - COMPOSE_FILE=/app/entrytwo/compose.yaml
      - APP_PUBLIC_URL=http://app:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./compose.yaml:/app/entrytwo/compose.yaml:ro
      - ./backups:/app/entrytwo/backups

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=entrytwo
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  postgres_data:
EOF

cp .env.example .env
# edit .env — set POSTGRES_PASSWORD, AUTH_SECRET, AUTH_URL, SMTP/OAuth, etc.

docker compose up -d --build
```

`docker compose up -d` after this pulls `ghcr.io/felixkrusch/entrytwo:latest` (the app image is pulled; the updater sidecar still builds from the local `updater/Dockerfile` since it needs the Docker socket). The app entrypoint runs `prisma migrate deploy`, then `next start`.

```bash
curl -sS https://your.domain/api/health
# expect: "ready": true, "status": "ok", auth.productionReady: true
```

Open the site → bootstrap first **ADMIN** → complete **TOTP** → company settings.

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
