#!/bin/sh
set -e

echo "entrytwo: running database migrations..."
npx prisma migrate deploy

echo "entrytwo: starting server..."
exec npm start
