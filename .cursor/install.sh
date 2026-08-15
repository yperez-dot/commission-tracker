#!/usr/bin/env bash
# Idempotent dependency + local-database setup for the OliComm Commission Tracker.
# Runs once to build the environment snapshot. Must terminate and be safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Ensuring PostgreSQL is installed"
if ! ls /usr/lib/postgresql/*/bin/initdb >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
PGDATA="${PGDATA:-$HOME/.pgdata}"

echo "==> Initializing local PostgreSQL cluster at $PGDATA (if needed)"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/tmp/olicomm-initdb.log 2>&1
fi

echo "==> Installing Node dependencies"
npm ci

echo "==> Install complete"
