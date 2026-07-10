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

if [ -z "$UPDATER_TOKEN" ] || [ "$UPDATER_TOKEN" = "changeme" ]; then
  echo "entrytwo: UPDATER_TOKEN must be configured" >&2
  exit 1
fi

echo "entrytwo: running database migrations..."
npx prisma migrate deploy

echo "entrytwo: starting server..."
exec npm start
