#!/bin/sh
set -e

if [ -z "$AUTH_SECRET" ] || [ ${#AUTH_SECRET} -lt 32 ]; then
  echo "entrytwo: AUTH_SECRET must be set to at least 32 characters" >&2
  exit 1
fi

if [ -z "$ENCRYPTION_KEY" ] || ! printf '%s' "$ENCRYPTION_KEY" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "entrytwo: ENCRYPTION_KEY must be exactly 64 hexadecimal characters" >&2
  exit 1
fi

if [ -z "$JOB_RUNNER_SECRET" ] || [ ${#JOB_RUNNER_SECRET} -lt 32 ]; then
  echo "entrytwo: JOB_RUNNER_SECRET must be set to at least 32 characters" >&2
  exit 1
fi

if [ "${1:-server}" != "worker" ] && { [ -z "$UPDATER_TOKEN" ] || [ "$UPDATER_TOKEN" = "changeme" ]; }; then
  echo "entrytwo: UPDATER_TOKEN must be configured" >&2
  exit 1
fi

echo "entrytwo: running database migrations..."
npx prisma migrate deploy

if [ "${1:-server}" = "worker" ]; then
  echo "entrytwo: starting durable job worker..."
  exec npm run worker
fi

echo "entrytwo: starting server..."
exec npm start
