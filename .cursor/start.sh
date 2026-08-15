#!/usr/bin/env bash
# Per-boot reconciliation: start the local PostgreSQL cluster and ensure the
# application database exists. Idempotent; tolerates restarts and then returns.
set -euo pipefail

PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PGDATA="${PGDATA:-$HOME/.pgdata}"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "PostgreSQL data directory $PGDATA is not initialized. Run .cursor/install.sh first." >&2
  exit 1
fi

echo "==> Starting PostgreSQL (if not already running)"
if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5432 -k /tmp" -l "$PGDATA/server.log" -w start
fi

echo "==> Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
  if "$PGBIN/pg_isready" -h localhost -p 5432 -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> Ensuring 'olicomm' database exists"
if ! "$PGBIN/psql" -h localhost -p 5432 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='olicomm'" | grep -q 1; then
  "$PGBIN/psql" -h localhost -p 5432 -U postgres -c "CREATE DATABASE olicomm;"
fi

echo "==> PostgreSQL ready on localhost:5432 (database: olicomm)"
